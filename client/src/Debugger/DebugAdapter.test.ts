import * as assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { ServerFn, ZsDebugAdapter } from './DebugAdapter';
import { OutputEvent, TerminatedEvent } from '@vscode/debugadapter';

const stack = {
	request: 'S',
	response: `
Stack:
--start:myFunc1(str,XXX) /path/to/file.zs:1
url= "a=b"
aa= func 1246098 obj 129854934376064
bb= 0
cc= "cc"
this= obj 129854938022608
--native code
--start:myFunc2(str,YYY) /path/to/file.zs:2
url= "a=b"
aa= func 1246098 obj 129854934376064
bb= 0
cc= "cc"
--native code
`,
};

const glob = {
	request: 'G',
	response: `
Globals:
A= 0
b= 1
_c= obj 129854919889568
d= ""
`,
};

const func = {
	request: 'D123',
	response: `
myFunc: x(A,B)
`,
};

const obj = {
	request: 'O123',
	response: `
 aa: AAAA
bb: obj 127229645385008
cc: null
dd*: null
ee: ""
`,
};

const serverFn: ServerFn = (socket) => {
	return { listen: (() => {}) as any };
};

describe('ZsDebugAdapter', () => {
	it('initializeRequest', async (t) => {
		const da = new ZsDebugAdapter({ serverFn });
		da.sendResponse = mock.fn();
		//@ts-expect-error tests
		da.initializeRequest({ body: {} });

		const expected = {
			supportsConfigurationDoneRequest: true,
			supportsEvaluateForHovers: true,
		};
		assert.deepEqual((da.sendResponse as any).mock.callCount(), 1);
		assert.deepEqual((da.sendResponse as any).mock.calls[0].arguments[0].body, expected);
	});

	it('threadsRequest', async () => {
		const da = new ZsDebugAdapter();
		da.sendResponse = mock.fn();
		//@ts-expect-error tests
		da.threadsRequest({ body: {} });

		const expected = { threads: [{ id: 1, name: 'thread 1' }] };
		assert.deepEqual((da.sendResponse as any).mock.callCount(), 1);
		assert.deepEqual((da.sendResponse as any).mock.calls[0].arguments[0].body, expected);
	});

	it('launchRequest', async () => {
		const onFn = mock.fn((name: string, cb: any) => {
			cb();
		});
		const stdoutOnFn = mock.fn((name: string, cb: any) => {
			cb('stdout');
		});
		const stderrOnFn = mock.fn((name: string, cb: any) => {
			cb('stderr');
		});
		const spawnFn = mock.fn(() => ({
			on: onFn,
			stdout: { on: stdoutOnFn },
			stderr: { on: stderrOnFn },
		})) as any;
		const da = new ZsDebugAdapter({ spawnFn });
		da.sendEvent = mock.fn();
		da.sendResponse = mock.fn();
		//@ts-expect-error tests
		da.launchRequest({}, { cmd: 'cmd' });

		assert.deepEqual(spawnFn.mock.callCount(), 1);
		assert.deepEqual(spawnFn.mock.calls[0].arguments, [
			'cmd',
			null,
			{
				detached: true,
				shell: true,
				stdio: ['pipe', 'pipe', 'pipe'],
			},
		]);

		assert.deepEqual((da.sendEvent as any).mock.callCount(), 3);

		assert.deepEqual((da.sendEvent as any).mock.calls[0].arguments, [
			new OutputEvent('stdout'.toString(), 'APP:'),
		]);
		assert.deepEqual((da.sendEvent as any).mock.calls[1].arguments, [
			new OutputEvent('stderr'.toString(), 'APP ERROR:'),
		]);
		assert.deepEqual((da.sendEvent as any).mock.calls[2].arguments, [
			new TerminatedEvent(),
		]);
	});

	it('setBreakPointsRequest', async () => {
		const da = new ZsDebugAdapter();
		da.sendResponse = mock.fn();
		//@ts-expect-error tests
		da.socket = { write: mock.fn(() => {}) };
		//@ts-expect-error tests
		await da.setBreakPointsRequest({} as any, {
			breakpoints: [{ line: 1 }],
			source: { path: '/path/to/file.zs' },
		});

		assert.deepEqual((da.sendResponse as any).mock.callCount(), 1);
		assert.deepEqual((da.sendResponse as any).mock.calls[0].arguments[0], {});

		//@ts-expect-error tests
		assert.deepEqual(((da.socket as any).write as any).mock.callCount(), 1);
		//@ts-expect-error tests
		assert.deepEqual(((da.socket as any).write as any).mock.calls[0].arguments, [
			'b1\n1 /path/to/file.zs\n',
		]);
	});

	it('stackTraceRequest', async () => {
		const da = new ZsDebugAdapter();
		da.sendResponse = mock.fn();
		//@ts-expect-error tests
		da.socketReq = mock.fn(() => Promise.resolve(stack.response));
		//@ts-expect-error tests
		await da.stackTraceRequest({ response: {} });

		const expected = {
			stackFrames: [
				{
					column: 1,
					id: 0,
					line: 1,
					name: ':myFunc1(str,XXX)',
					presentationHint: 'normal',
					source: { path: '/path/to/file.zs' },
				},
				{
					column: 1,
					id: 1,
					line: 2,
					name: ':myFunc2(str,YYY)',
					presentationHint: 'normal',
					source: { path: '/path/to/file.zs' },
				},
			],
			totalFrames: 2,
		};

		assert.deepEqual((da.sendResponse as any).mock.callCount(), 1);
		assert.deepEqual((da.sendResponse as any).mock.calls[0].arguments[0].body, expected);
	});

	it('scopesRequest', async () => {
		const da = new ZsDebugAdapter();
		da.sendResponse = mock.fn();
		//@ts-expect-error tests
		da.socketReq = mock.fn((cmd) => {
			if (cmd === stack.request) return Promise.resolve(stack.response);
			if (cmd === glob.request) return Promise.resolve(glob.response);
		});
		//@ts-expect-error tests
		da.stack = await da.getStack();
		//@ts-expect-error tests
		await da.scopesRequest({ body: {} }, {});

		assert.deepEqual((da.sendResponse as any).mock.callCount(), 1);
		assert.deepEqual((da.sendResponse as any).mock.calls[0].arguments[0].body, {
			scopes: [
				{ expensive: false, name: 'Locals', variablesReference: 1000 },
				{ expensive: false, name: 'Globals', variablesReference: 1001 },
			],
		});

		//@ts-expect-error tests
		const locals = await da.handles.get(1000)();
		//@ts-expect-error tests
		const globals = await da.handles.get(1001)();

		assert.deepEqual(locals, [
			{ name: 'url', value: '"a=b"', variablesReference: 0 },
			{ name: 'aa', value: 'func 1246098 obj 129854934376064', variablesReference: 1002 },
			{ name: 'bb', value: '0', variablesReference: 0 },
			{ name: 'cc', value: '"cc"', variablesReference: 0 },
			{ name: 'this', value: 'obj 129854938022608', variablesReference: 1003 },
		]);
		assert.deepEqual(globals, [
			{ name: 'A', value: '0', variablesReference: 0 },
			{ name: 'b', value: '1', variablesReference: 0 },
			{ name: '_c', value: 'obj 129854919889568', variablesReference: 1004 },
			{ name: 'd', value: '""', variablesReference: 0 },
		]);
	});

	it('evaluateRequest: hover & watch', async () => {
		const da = new ZsDebugAdapter();
		da.sendResponse = mock.fn();
		//@ts-expect-error tests
		da.socketReq = mock.fn((cmd) => {
			if (cmd === stack.request) return Promise.resolve(stack.response);
			if (cmd === glob.request) return Promise.resolve(glob.response);
			if (cmd.startsWith('O')) return Promise.resolve(obj.response);
		});
		//@ts-expect-error tests
		da.stack = await da.getStack();
		//@ts-expect-error tests
		await da.evaluateRequest({ body: {} }, { context: 'hover', expression: 'url' });

		assert.deepEqual((da.sendResponse as any).mock.callCount(), 1);
		assert.deepEqual((da.sendResponse as any).mock.calls[0].arguments[0].body, {
			result: '"a=b"',
			variablesReference: undefined,
		});
	});
});
