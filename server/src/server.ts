/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	DocumentDiagnosticReportKind,
	type DocumentDiagnosticReport,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { LSP } from 'zs-lsp/dist/LSP';
import url from 'url';

const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

const lsp = new LSP();

connection.onInitialize(async (params: InitializeParams) => {
	await lsp.init();
	const capabilities = params.capabilities;

	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: {
				resolveProvider: true,
			},
			hoverProvider: true,
			definitionProvider: true, // ctrl + click
			declarationProvider: true, // from ctx menu
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false,
			},
			signatureHelpProvider: {
				triggerCharacters: ['('],
			},
		},
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true,
			},
		};
	}
	return result;
});

connection.onInitialized(async () => {
	console.log('Server initialized');
	const settings = await connection.workspace.getConfiguration('zsLSP');
	const workspaceFolders = await connection.workspace.getWorkspaceFolders();
	LSP.root =
		settings.root === '${workspaceFolder}'
			? url.fileURLToPath(workspaceFolders![0].uri)
			: settings.root;
	LSP.includes = settings.includes;

	if (hasConfigurationCapability) {
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders((_event) => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}
	// Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
	// We could optimize things here and re-fetch the setting first can compare it
	// to the existing setting, but this is out of scope for this example.
	connection.languages.diagnostics.refresh();
});

documents.onDidClose((e) => {
	documentSettings.delete(e.document.uri);
});

documents.onDidChangeContent((change) => {
	lsp.setCache(change.document.uri, change.document.getText());
});

connection.onCompletion(lsp.completitionProvider.provideCompletionItems.bind(lsp.completitionProvider));
connection.onCompletionResolve((item: CompletionItem): CompletionItem => item);

connection.onDeclaration(
	lsp.declarationProvider.provideDeclaration.bind(lsp.declarationProvider)
);


connection.onDefinition(
	lsp.declarationProvider.provideDeclaration.bind(lsp.declarationProvider)
);

connection.onHover(lsp.hoverProvider.provideHover.bind(lsp.hoverProvider));

connection.languages.diagnostics.on(
	lsp.diagnosticProvider.updateDiagnostics.bind(lsp.diagnosticProvider)
);

documents.listen(connection);
connection.listen();
