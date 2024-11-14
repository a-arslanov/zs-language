import {
	Handles,
	InitializedEvent,
	LoggingDebugSession,
	OutputEvent,
	Scope,
	StoppedEvent,
	TerminatedEvent,
	Thread,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import {
	ChildProcessWithoutNullStreams,
	spawn,
	SpawnOptionsWithoutStdio,
} from 'node:child_process';
import { createServer, Server, Socket } from 'node:net';
import treeKill from 'tree-kill';

interface Frame {
	name: string;
	path: string;
	line: number;
	fragment: string;
}

export type ServerFn = (socket: Partial<Socket>) => Partial<Server>;
export type SpawnFn = (
	command: string,
	args?: string[],
	options?: Partial<SpawnOptionsWithoutStdio>
) => Partial<ChildProcessWithoutNullStreams>;

interface Deps {
	serverFn?: ServerFn;
	spawnFn?: SpawnFn;
}

export class ZsDebugAdapter extends LoggingDebugSession {
	private server: Server;
	private socket: Socket;
	private proc: Partial<ChildProcessWithoutNullStreams>;
	private breakpoints: Map<string, Set<number>> = new Map();
	private handles = new Handles<
		() => DebugProtocol.Variable[] | Promise<DebugProtocol.Variable[]>
	>();
	private deps: Deps;
	private stack: Frame[] = [];

	constructor(deps?: Deps) {
		super();
		this.deps = deps;
	}

	private async socketListener(data: Buffer) {
		const dataText = data.toString();
		switch (dataText[0]) {
			case 'l': {
				this.socket.write('start\n');
				this.sendEvent(new InitializedEvent());
				break;
			}
			case 'b': {
				const event = new StoppedEvent('breakpoint');
				const body: DebugProtocol.StoppedEvent['body'] = event.body;

				body.allThreadsStopped = true;
				body.hitBreakpointIds = [Number(dataText.split(' ')[1])];
				this.sendEvent(event);
				break;
			}
			case 'e': {
				this.sendEvent(new OutputEvent(dataText, 'ERROR:'));
				break;
			}
			case 'p': {
				this.sendEvent(new OutputEvent(dataText, 'LOG:'));
				break;
			}
			default: {
				//
			}
		}
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse): void {
		const serverFn = this.deps?.serverFn ?? createServer;
		this.server = serverFn((socket) => {
			this.socket = socket;
			this.socket.on('data', this.socketListener.bind(this));
		}).listen(2009);
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsEvaluateForHovers = true;

		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [new Thread(1, 'thread 1')],
		};
		this.sendResponse(response);
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: any): void {
		super.launchRequest(response, args);
		const spawnFn = this.deps?.spawnFn ?? spawn;
		this.proc = spawnFn(args.cmd, null, {
			detached: true,
			shell: true,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		this.proc.stdout.on('data', (data) => {
			this.sendEvent(new OutputEvent(data.toString(), 'APP:'));
		});
		this.proc.stderr.on('data', (data) => {
			this.sendEvent(new OutputEvent(data.toString(), 'APP ERROR:'));
		});
		this.proc.on('close', () => {
			this.sendEvent(new TerminatedEvent());
		});
	}

	protected async setBreakPointsRequest(
		response: DebugProtocol.SetBreakpointsResponse,
		args: DebugProtocol.SetBreakpointsArguments
	): Promise<void> {
		this.breakpoints.set(args.source.path, new Set(args.breakpoints.map((bp) => bp.line)));
		let count = 0;
		const bps = [...this.breakpoints.entries()].reduce((acc, [path, lines]) => {
			[...lines].forEach((line) => {
				acc += `${line} ${path}\n`;
				count++;
			});
			return acc;
		}, '');
		this.sendResponse(response);
		this.socket.write(`b${count}\n${bps}`);
	}

	private async getStack() {
		const framesString = (await this.socketReq('S', (v) => v.includes('Stack'))).split(
			'--start'
		);
		framesString.shift();
		const frames = framesString.map((frameData) => {
			const frame = frameData.split('\n');
			const header = frame.shift();
			const [name, pathAndLine] = header.split(' ');
			const [path, line] = pathAndLine.split(':');
			return {
				name,
				path,
				line: Number(line),
				fragment: frame.join('\n'),
			};
		});
		return frames;
	}

	protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse) {
		this.stack = await this.getStack();
		response.body = {
			stackFrames: this.stack.map((frame, index) => ({
				id: index,
				name: frame.name,
				source: { path: frame.path },
				line: Number(frame.line),
				column: 1,
				presentationHint: 'normal',
			})),
			totalFrames: this.stack.length,
		};

		this.sendResponse(response);
	}

	protected async scopesRequest(
		response: DebugProtocol.ScopesResponse,
		args: DebugProtocol.ScopesArguments
	) {
		const frame = this.stack[args?.frameId ?? 0];
		const localScope = new Scope(
			'Locals',
			this.handles.create(async () => this.parseVarables(frame.fragment)),
			false
		);
		const globalScope = new Scope(
			'Globals',
			this.handles.create(async () => {
				const lines = (await this.socketReq('G', (v) => v.includes('Globals')))
					.replace('Globals:', '');
				return this.parseVarables(lines);
			}),
			false
		);
		response.body = {
			scopes: [localScope, globalScope],
		};
		this.sendResponse(response);
	}

	protected disconnectRequest(
		response: DebugProtocol.DisconnectResponse,
		args: DebugProtocol.DisconnectArguments
	): void {
		super.disconnectRequest(response, args);
		this.socket.end();
		this.server.close();
		treeKill(this.proc.pid);
	}

	private async socketReq(cmd: string, condition: (r: string) => boolean) {
		return (await new Promise((resolve) => {
			const listener = (data: Buffer) => {
				const dataText = data.toString();
				if (condition(dataText)) {
					resolve(dataText);
					this.socket.removeListener('data', listener);
				}
			};
			this.socket.addListener('data', listener);
			this.socket.write(cmd);
		})) as string;
	}

	private parseVarables(fragment: string): DebugProtocol.Variable[] {
		return fragment
			.split('\n')
			.filter((l) => l.includes('= ') || l.includes(': '))
			.map((l) => {
				const [name, value] = l.split(/=\s|:\s/).map((l) => l.trim());

				const isRef = value.includes('obj') || value.includes('fun');
				return {
					name: name.replace('*', ''),
					value,
					variablesReference: isRef ? this.handles.create(async () => {
						if (value.startsWith('obj')) {
							return this.parseVarables(
								await this.socketReq(`O${value.split(' ')[1]}\n`, () => true)
							);
						}
						if (value.startsWith('fun')) {
							return this.parseVarables(
								await this.socketReq(`D${value.split(' ')[1]}\n`, () => true)
							);
						}
						return null;
					}) : 0,
				};
			});
	}

	protected async evaluateRequest(
		response: DebugProtocol.EvaluateResponse,
		args: DebugProtocol.EvaluateArguments
	) {
		if (args.context === 'repl') {
			this.socket.write(`${args.expression}`, 'utf-8');
			this.sendResponse(response);
			return;
		}
		if (args.context === 'hover' || args.context === 'watch') {
			const frame = this.stack[args.frameId ?? 0];

			const globals = this.parseVarables(
				await this.socketReq('G', (v) => v.includes('Globals'))
			);
			const locals = this.parseVarables(frame.fragment);
			const thisVar = locals.find((e) => e.name === 'this');
			const ctx = thisVar
				? this.parseVarables(
						await this.socketReq(`O${thisVar.value.split(' ')[1]}\n`, () => true)
				)
				: null;

			const localVar = locals.find((v) => v.name === args.expression);
			if (localVar) {
				response.body = {
					result: localVar.value,
					variablesReference: localVar.valueLocationReference,
				};
			}

			const ctxVar = ctx?.find((v) => v.name === args.expression);
			if (ctxVar) {
				response.body = {
					result: ctxVar.value,
					variablesReference: ctxVar.valueLocationReference,
				};
			}

			const globalVar = globals.find((v) => v.name === args.expression);
			if (globalVar) {
				response.body = {
					result: globalVar.value,
					variablesReference: globalVar.valueLocationReference,
				};
			}

			this.sendResponse(response);
		}
	}

	protected async variablesRequest(
		response: DebugProtocol.VariablesResponse,
		args: DebugProtocol.VariablesArguments
	) {
		response.body = { variables: await this.handles.get(args.variablesReference)() };
		this.sendResponse(response);
	}

	protected configurationDoneRequest(
		response: DebugProtocol.ConfigurationDoneResponse,
		args: DebugProtocol.ConfigurationDoneArguments
	) {
		super.configurationDoneRequest(response, args);
		this.socket.write('g');
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse) {
		this.socket.write('g');
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse) {
		this.socket.write('s');
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse) {
		this.socket.write('d');
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse) {
		this.socket.write('u');
		this.sendResponse(response);
	}
}
