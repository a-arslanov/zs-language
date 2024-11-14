import {
	DebugAdapterDescriptor,
	DebugAdapterDescriptorFactory,
	DebugAdapterInlineImplementation,
	DebugSession,
	ProviderResult,
} from 'vscode';
import { ZsDebugAdapter } from './DebugAdapter';

export class DebugAdapterFactory implements DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(
		_session: DebugSession
	): ProviderResult<DebugAdapterDescriptor> {
		return new DebugAdapterInlineImplementation(
			new ZsDebugAdapter()
		);
	}
}
