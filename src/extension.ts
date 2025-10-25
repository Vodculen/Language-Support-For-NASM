import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';

const controls = [
    "mov", "lea", "push", "pop", "call", "ret", "jmp", "je", "jne", "jg", "jl", "jge", "jle", "ja", "jb", "jz", "jnz", "jo", "jno", "js", "jns", "jc", "jnc", "add", "sub", "mul", "imul", "div", "idiv", "inc", "dec", "neg", "cmp", "test", "adc", "sbb", "and", "or", "xor", "not", "shl", "shr", "sal", "sar", "rol", "ror", "rcl", "rcr", "clc", "stc", "cmc", "cli", "sti", "cld", "std", "int", "iret", "syscall", "sysret", "nop", "hlt", "pause"
];

const directives = [
	"section", "global", "extern", "equ", "db", "dw", "dd", "dq", "resb", "resw", "resd", "resq", "times", "align", "org", "segment", "end", "byte", "word", "dword", "qword", "tbyte", "proc", "endp", "if", "else", "endif", "repeat", "until", "while", "align", "alignb", "alignw", "alignd", "alignq", "db", "dw", "dd", "dq", "resb", "resw", "resd", "resq", "equ", "macro", "endm", "include", "incbin", "assert"
];

const registers = [
	"rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rsp", "rbp", "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15", "eax", "ebx", "ecx", "edx", "esi", "edi", "esp", "ebp", "ax", "bx", "cx", "dx", "si", "di", "sp", "bp", "al", "bl", "cl", "dl", "ah", "bh", "ch", "dh", "spl", "bpl", "sil", "dil", "r8d", "r9d", "r10d", "r11d", "r12d", "r13d", "r14d", "r15d", "r8w", "r9w", "r10w", "r11w", "r12w", "r13w", "r14w", "r15w", "r8b", "r9b", "r10b", "r11b", "r12b", "r13b", "r14b", "r15b"
];

const sections = [
	"data", "text", "bss", "rodata", "data", "_start", "reloc", "code"
];

let symbols = Array.from(new Set([...controls, ...directives, ...registers, ...sections]));
let diagnosticCollection: vscode.DiagnosticCollection;
let debounceTimer: NodeJS.Timeout | undefined;

// Activate extension
export function activate(context: vscode.ExtensionContext) {
    // Hover provider
    const hover = vscode.languages.registerHoverProvider('nasm', {
        provideHover(document, position) {
			const wordRange = document.getWordRangeAtPosition(position);
			const word = wordRange ? document.getText(wordRange) : '';
			const lowerWord = word.toLowerCase();

			let hoverText: string | undefined;

			if (registers.includes(lowerWord)) {
				hoverText = `\`\`\`nasm\n${word} ; NASM register\n\`\`\``;
			} else if (controls.includes(lowerWord) || directives.includes(word)) {
				hoverText = `\`\`\`nasm\n${word} ; NASM instruction\n\`\`\``;
			} else if (sections.includes(lowerWord)) {
				hoverText = `\`\`\`nasm\n${word} ; NASM section\n\`\`\``;
			}

			if (hoverText) {
				return new vscode.Hover(hoverText);
			}

			return undefined;
		}
    });

	function setTabSize(editor: vscode.TextEditor) {
        if (editor.document.languageId === 'nasm') {
            editor.options = {
                ...editor.options,
                tabSize: 10
            };
        }
    }

    // When a new editor is opened
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            setTabSize(editor);
        }
    });

    // When a document is first opened
    vscode.workspace.onDidOpenTextDocument(doc => {
        const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
        if (editor) {
            setTabSize(editor);
        }
    });

    // Completion provider
    const completion = vscode.languages.registerCompletionItemProvider('nasm', {
        provideCompletionItems(document, position) {
            const start = document.getText(document.getWordRangeAtPosition(position)) || '';
            const items = symbols
                .filter(k => k.startsWith(start.toLowerCase()))
                .map(k => new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword));
            return new vscode.CompletionList(items, true);
        }
    }, '.', '_', '');

    // Diagnostics
    diagnosticCollection = vscode.languages.createDiagnosticCollection('nasm');

    vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId === 'nasm') {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                updateDiagnostics(event.document);
            }, 500);
        }
    });

    // Clean up diagnostics when closing file
    vscode.workspace.onDidCloseTextDocument(document => {
        diagnosticCollection.delete(document.uri);
    });

    context.subscriptions.push(diagnosticCollection, completion, hover);
}

function updateDiagnostics(document: vscode.TextDocument): void {
    const filePath = document.fileName;
    const fs = require('fs');
    const os = require('os');
    const tempFile = path.join(os.tmpdir(), path.basename(filePath));

    fs.writeFileSync(tempFile, document.getText());

	exec('nasm -v', (err) => {
		if (err) {
			vscode.window.showErrorMessage('NASM is not installed or not in PATH.');
		}
	});

    // Platform-specific null output
    const tempOutput = path.join(os.tmpdir(), path.basename(filePath) + '.o');

    const cmd = `nasm -f elf64 "${tempFile}" -o "${tempOutput}"`;

    exec(cmd, (err, stdout, stderr) => {
        const diagnostics: vscode.Diagnostic[] = [];
        const regex = /(.*):(\d+): (error|warning): (.*)/;

        stderr.split('\n').forEach(line => {
            const match = regex.exec(line);
            if (match) {
                const [_, file, lineNum, severity, msg] = match;
                const lineIndex = Number(lineNum) - 1;

                const range = new vscode.Range(new vscode.Position(lineIndex, 0), new vscode.Position(lineIndex, 999));

                const diagnostic = new vscode.Diagnostic(
                    range,
                    msg,
                    severity === 'error'
                        ? vscode.DiagnosticSeverity.Error
                        : vscode.DiagnosticSeverity.Warning
                );
                diagnostics.push(diagnostic);
            }
        });

        if (diagnostics.length > 0) {
            diagnosticCollection.set(document.uri, diagnostics);
        } else {
            diagnosticCollection.delete(document.uri);
        }
    });
}

// Deactivate extension
export function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}
