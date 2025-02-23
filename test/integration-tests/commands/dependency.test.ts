//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import { expect } from "chai";
import * as vscode from "vscode";
import {
    PackageDependenciesProvider,
    PackageNode,
} from "../../../src/ui/PackageDependencyProvider";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities/tasks";
import { getBuildAllTask, SwiftTask } from "../../../src/tasks/SwiftTaskProvider";
import { testAssetUri } from "../../fixtures";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import * as sinon from "sinon";
import { Commands } from "../../../src/commands";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

suite("Dependency Commmands Test Suite", function () {
    // full workflow's interaction with spm is longer than the default timeout
    // 60 seconds for each test should be more than enough
    this.timeout(60 * 1000);

    suite("spm Update Contract Tests", function () {
        let folderContext: FolderContext;
        let workspaceContext: WorkspaceContext;

        activateExtensionForSuite({
            async setup(ctx) {
                workspaceContext = ctx;
                await waitForNoRunningTasks();
                folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
                await workspaceContext.focusFolder(folderContext);
            },
        });

        test("Contract: spm update", async function () {
            // Contract: spm update
            const result = await vscode.commands.executeCommand(Commands.UPDATE_DEPENDENCIES);
            expect(result).to.be.true;
        });
    });

    suite("spm Resolve Contract Tests", function () {
        let folderContext: FolderContext;
        let workspaceContext: WorkspaceContext;

        activateExtensionForSuite({
            async setup(ctx) {
                workspaceContext = ctx;
                await waitForNoRunningTasks();
                folderContext = await folderInRootWorkspace("dependencies", workspaceContext);
                await workspaceContext.focusFolder(folderContext);
            },
        });

        test("Contract: spm resolve", async () => {
            const result = await vscode.commands.executeCommand(Commands.RESOLVE_DEPENDENCIES);
            expect(result).to.be.true;
        });
    });

    suite("Full Work Flow Test Suite", function () {
        let folderContext: FolderContext;
        let workspaceContext: WorkspaceContext;
        let tasks: SwiftTask;
        let treeProvider: PackageDependenciesProvider;
        let item: PackageNode;

        activateExtensionForSuite({
            async setup(ctx) {
                // FIXME: Disable this test suite as this is dependent on external git dependency
                // and introduces flakinesss when run in the CI setting. The spm command only
                // runs if the dependency is remote, which make faking difficult.
                // For enabling the test in the future, we would need to set up the environment
                // into a pre-resolved state, so spm does not need to visit remote git url.
                this.skip();
                // Check before each test case start:
                // Expect to fail without setting up local version
                workspaceContext = ctx;
                await waitForNoRunningTasks();
                folderContext = await folderInRootWorkspace("dependencies", workspaceContext);
                await workspaceContext.focusFolder(folderContext);

                tasks = (await getBuildAllTask(folderContext)) as SwiftTask;
                const { exitCode, output } = await executeTaskAndWaitForResult(tasks);
                expect(exitCode, `${output}`).to.not.equal(0);
                expect(output).to.include("PackageLib");
                expect(output).to.include("required");

                treeProvider = new PackageDependenciesProvider(workspaceContext);

                const items = await treeProvider.getChildren();
                item = items.find(n => n.name === "swift-markdown") as PackageNode;
            },
            async teardown() {
                treeProvider?.dispose();
            },
        });

        async function useLocalDependencyTest() {
            // Contract: spm edit with user supplied local version of dependency
            const windowMock = sinon.stub(vscode.window, "showOpenDialog");
            windowMock.resolves([testAssetUri("Swift-Markdown")]);
            let result = await vscode.commands.executeCommand(Commands.USE_LOCAL_DEPENDENCY, item);
            expect(result).to.be.true;
            windowMock.restore();

            // Make sure new dependencies resolve before building
            result = await vscode.commands.executeCommand(Commands.RESOLVE_DEPENDENCIES);
            expect(result).to.be.true;

            // This will now pass as we have the required library
            const { exitCode, output } = await executeTaskAndWaitForResult(tasks);
            expect(exitCode, `${output}`).to.equal(0);
            expect(output).to.include("defaultpackage");
            expect(output).to.include("not used by any target");
        }

        async function assertDependencyNoLongerExists() {
            // Expect to fail again now dependency is missing
            const { exitCode, output } = await executeTaskAndWaitForResult(tasks);
            expect(exitCode, `${output}`).to.not.equal(0);
            expect(output).to.include("PackageLib");
            expect(output).to.include("required");
        }

        test("Use local dependency - Reset", async function () {
            // spm reset after using local dependency is broken on windows
            if (process.platform === "win32") {
                this.skip();
            }
            await useLocalDependencyTest();

            // Contract: spm reset
            const result = await vscode.commands.executeCommand(Commands.RESET_PACKAGE);
            expect(result).to.be.true;

            await assertDependencyNoLongerExists();
        });

        test("Use local dependency - Add to workspace - Unedit", async () => {
            await useLocalDependencyTest();

            // Contract: spm unedit
            const result = await vscode.commands.executeCommand(Commands.UNEDIT_DEPENDENCY, item);
            expect(result).to.be.true;

            await assertDependencyNoLongerExists();
        });
    });
});
