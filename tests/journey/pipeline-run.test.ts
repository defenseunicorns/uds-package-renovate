import { expect, test} from '@jest/globals';
import { K8s, kind } from "kubernetes-fluent-client";
import { zarfExec, retry } from "../common";
import * as path from 'path';
import { execSync } from 'child_process';
import { rm } from 'fs/promises';

const domainSuffix = process.env.DOMAIN_SUFFIX || ".uds.dev"

test('upload archivista', async () => {
    const sourceRepoName = 'archivista'
    const expectedStatus = 'success'
    const expectedJobLogOutputs: string[] = ['Hello Kitteh']

    await executeTest(sourceRepoName, expectedJobLogOutputs, expectedStatus)
}, 90000);

async function executeTest(sourceRepoName: string, expectedJobLogOutputs: string[], expectedStatus: string) {
    const user = 'doug'
    const nowMillis = Date.now()
    var sourceDir = path.join(__dirname, 'repo-sources', sourceRepoName)

    const token = await getToken(user);
    console.log(`Using token [${token}] for user [${user}]`)
    const headers: HeadersInit = [["PRIVATE-TOKEN", token]]

    const gitLabProjectName = `${sourceRepoName}-${nowMillis}`
    const projectId = await createNewGitlabProject(sourceDir, user, token, gitLabProjectName, headers)
    await inviteRenovateBotToProject(headers, projectId, token);

    const gitLabProjectName2 = `${sourceRepoName}-${nowMillis}-2`
    const secondProjectId = await createNewGitlabProject(sourceDir, user, token, gitLabProjectName2, headers)
}

async function inviteRenovateBotToProject(headers: HeadersInit, projectId: any, token: string) {
    const userResp = await fetch(`https://gitlab${domainSuffix}/api/v4/users?username=renovatebot`, { headers });
    const userJson = await userResp.json();

    const renovateUserId = userJson[0]?.id

    const response = await fetch(`https://gitlab${domainSuffix}/api/v4/projects/${projectId}/members`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'PRIVATE-TOKEN': token,
        },
        body: JSON.stringify({
            user_id: renovateUserId,
            access_level: 30, // Developer access level
        }),
    });

    console.log(response);
}

async function getToken(user: string) : Promise<string> {
    const secret = await K8s(kind.Secret).InNamespace('gitlab').Get(`gitlab-token-${user}`);
    if (secret.data) {
        return atob(secret.data['TOKEN'])
    } else {
        return "";
    }
}

async function createNewGitlabProject(sourceDir: string, user: string, tokenName: string, gitLabProjectName: string, headers: HeadersInit) {
    await deleteDirectory(path.join(sourceDir, '.git')) 
    execSync('git init', { cwd: sourceDir })
    execSync('git add . ', { cwd: sourceDir })
    execSync('git config commit.gpgsign false', { cwd: sourceDir }) // need this so that gpg signing doesn't attempt to happen locally when running tests
    execSync('git config user.name "Doug Unicorn"', { cwd: sourceDir })
    execSync('git config user.email "doug@uds.dev"', { cwd: sourceDir })
    execSync('git commit -m "Initial commit" ', { cwd: sourceDir })
    execSync(`git remote add origin https://${user}:${tokenName}@gitlab${domainSuffix}/${user}/${gitLabProjectName}.git`, { cwd: sourceDir })
    execSync('git push -u origin --all', { cwd: sourceDir })
    await deleteDirectory(path.join(sourceDir, '.git'))

    console.log(`Finding project id for project name [${encodeURIComponent(gitLabProjectName)}]`)
    const projectResp = await fetch(`https://gitlab${domainSuffix}/api/v4/projects?search=${encodeURIComponent(gitLabProjectName)}`, { headers })
    const projects = await projectResp.json()

    const project = projects.find((p: { name: string; }) => p.name === gitLabProjectName)
    const projectId = project?.id
    console.log(`Found project id [${projectId}]`)
    return projectId
}

async function deleteDirectory(path: string) {
    try {
        await rm(path, { recursive: true, force: true })
        console.log(`Directory ${path} has been deleted successfully.`)
    } catch (error) {
        console.error(`Error while deleting directory ${path}:`, error)
    }
}
