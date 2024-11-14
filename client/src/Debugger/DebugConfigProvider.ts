import * as vscode from 'vscode';
import {
	DebugConfiguration,
	DebugConfigurationProvider,
	ProviderResult,
	WorkspaceFolder,
} from 'vscode';
import { CancellationToken } from 'vscode-languageclient';

export class ZSDebugConfigurationProvider implements DebugConfigurationProvider {
	resolveDebugConfiguration(
		folder: WorkspaceFolder,
		config: DebugConfiguration,
		token?: CancellationToken
	): ProviderResult<DebugConfiguration> {
		if (!config.cmd) {
			return vscode.window
				.showInformationMessage(
					"Please provide a path to the ZS executable in the 'cmd' field of the debug configuration."
				)
				.then((_) => {
					return undefined;
				});
		}
		return config;
	}
}
