/**
 * Copyright 2024 Defense Unicorns
 * SPDX-License-Identifier: AGPL-3.0-or-later OR LicenseRef-Defense-Unicorns-Commercial
 */

import { expect, test} from '@jest/globals';
import { K8s, kind } from "kubernetes-fluent-client";
import { zarfExec, retry } from "../common";
import * as path from 'path';
import { execSync } from 'child_process';
import { rm } from 'fs/promises';

const domainSuffix = process.env.DOMAIN_SUFFIX || ".uds.dev"
const renovateUserName = "renovatebot"

test('upload multiple demo-repos', async () => {
    const sourceRepoNames = ['demo-repo-maven', 'demo-repo-zarf']; // List of repos
    const user = 'root';
    const nowMillis = Date.now();
    
    const token = await createToken(nowMillis);
    const headers: HeadersInit = [["PRIVATE-TOKEN", token]];

    const projectIdMap: { [key: string]: { withRenovate: string, withoutRenovate: string } } = {};

    // upload each repo to gitlab twice, invite renovate to the first one only, store both project ids for later
    for (const sourceRepoName of sourceRepoNames) {
        const sourceDir = path.join(__dirname, 'repo-sources', sourceRepoName);

        // Create project with Renovate
        const projectWithRenovate = `${sourceRepoName}-${nowMillis}`;
        const projectIdWithRenovate = await createNewGitlabProject(sourceDir, user, token, projectWithRenovate, headers);
        await inviteRenovateBotToProject(headers, projectIdWithRenovate, token);

        // Create project without Renovate
        const projectWithoutRenovate = `${sourceRepoName}-${nowMillis}-no-renovate`;
        const projectIdWithoutRenovate = await createNewGitlabProject(sourceDir, user, token, projectWithoutRenovate, headers);

        projectIdMap[sourceRepoName] = {
            withRenovate: projectIdWithRenovate,
            withoutRenovate: projectIdWithoutRenovate
        };        
    }

    // Kick off a manual Renovate run and wait for completion
    const jobName = await createJobFromCronJob('renovate', 'renovate');
    waitForJobCompletion(jobName, 'renovate', 120);

    // checks for the zarf project, it already has a renovate config so it should get a dashboard issue
    const mergeRequestFoundWithRenovateZarf = await findMergeRequest(token, `${projectIdMap['demo-repo-zarf'].withRenovate}`, renovateUserName, 'Configure Renovate');
    const mergeRequestFoundWithoutRenovateZarf = await findMergeRequest(token, `${projectIdMap['demo-repo-zarf'].withoutRenovate}`, renovateUserName, 'Configure Renovate');
    const issueFoundWithRenovateZarf = await findOpenIssue(token, `${projectIdMap['demo-repo-zarf'].withRenovate}`, renovateUserName, 'Renovate Dashboard 🤖');
    const issueFoundWithoutRenovateZarf = await findOpenIssue(token, `${projectIdMap['demo-repo-zarf'].withoutRenovate}`, renovateUserName, 'Renovate Dashboard 🤖');

    expect(mergeRequestFoundWithRenovateZarf).toBe(false);
    expect(mergeRequestFoundWithoutRenovateZarf).toBe(false);
    expect(issueFoundWithRenovateZarf).toBe(true);
    expect(issueFoundWithoutRenovateZarf).toBe(false);

    // checks for the maven project, it does not have a renovate config so it should get an onboarding pr
    const mergeRequestFoundWithRenovateMaven = await findMergeRequest(token, `${projectIdMap['demo-repo-maven'].withRenovate}`, renovateUserName, 'Configure Renovate');
    const mergeRequestFoundWithoutRenovateMaven = await findMergeRequest(token, `${projectIdMap['demo-repo-maven'].withoutRenovate}`, renovateUserName, 'Configure Renovate');
    const issueFoundWithRenovateMaven = await findOpenIssue(token, `${projectIdMap['demo-repo-maven'].withRenovate}`, renovateUserName, 'Renovate Dashboard 🤖');
    const issueFoundWithoutRenovateMaven = await findOpenIssue(token, `${projectIdMap['demo-repo-maven'].withoutRenovate}`, renovateUserName, 'Renovate Dashboard 🤖');

    expect(mergeRequestFoundWithRenovateMaven).toBe(true);
    expect(mergeRequestFoundWithoutRenovateMaven).toBe(false);
    expect(issueFoundWithRenovateMaven).toBe(false);
    expect(issueFoundWithoutRenovateMaven).toBe(false);

}, 150000);

async function inviteRenovateBotToProject(headers: HeadersInit, projectId: any, token: string) {
    const userResp = await fetch(`https://gitlab${domainSuffix}/api/v4/users?username=${renovateUserName}`, { headers });
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
}

async function createToken(nowMillis: number) : Promise<string> {
    const toolboxPods = await K8s(kind.Pod).InNamespace("gitlab").WithLabel("app", "toolbox").Get()
    const toolboxPod = toolboxPods.items.at(0)
    const result = zarfExec(["tools",
        "kubectl",
        "--namespace", "gitlab",
        "exec",
        "-i",
        toolboxPod?.metadata?.name!,
        "--",
        `gitlab-rails runner "token = User.find_by_username('root').personal_access_tokens.create(scopes: ['api', 'admin_mode', 'read_repository', 'write_repository'], name: 'Root Test Token ${nowMillis}', expires_at: 2.days.from_now); token.save!; puts token.token"`
    ], true);

    return result.stdout.toString().trim()
}

async function createNewGitlabProject(sourceDir: string, user: string, tokenName: string, gitLabProjectName: string, headers: HeadersInit) {
    console.log(`Uploading directory ${sourceDir} to gitlab as ${gitLabProjectName}`)
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


async function findMergeRequest(token: string, projectId: string, userid: string, title: string): Promise<boolean> {
    try {
        const url = `https://gitlab${domainSuffix}/api/v4/projects/${projectId}/merge_requests?state=opened&per_page=1`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`GitLab API request failed: ${response.statusText}`);
        }

        const mergeRequests = await response.json();

        if (mergeRequests.length === 0) {
            console.log('No merge requests found');
            return false;
        }

        const firstMergeRequest = mergeRequests[0];

        const foundExpectedMergeRequest = firstMergeRequest.author.username === userid &&
                                          firstMergeRequest.title === title;

        if (foundExpectedMergeRequest) {
            console.log(`Found merge request from '${userid}' with title '${title}'.`);
        } else {
            console.log('No matching merge request found.');
        }

        return foundExpectedMergeRequest;
    } catch (error) {
        console.error('Error while fetching merge requests:', error);
        return false;
    }
}

async function findOpenIssue(token: string, projectId: string, userid: string, title: string): Promise<boolean> {
    try {
        const url = `https://gitlab${domainSuffix}/api/v4/projects/${projectId}/issues?state=opened&per_page=1`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`GitLab API request failed: ${response.statusText}`);
        }

        const issues = await response.json();

        if (issues.length === 0) {
            console.log('No open issues found');
            return false;
        }

        const firstIssue = issues[0];

        const foundExpectedIssue = firstIssue.author.username === userid &&
                                   firstIssue.title === title;

        if (foundExpectedIssue) {
            console.log(`Found issue from '${userid}' with title '${title}'.`);
        } else {
            console.log('No matching issue found.');
        }

        return foundExpectedIssue;
    } catch (error) {
        console.error('Error while fetching issues:', error);
        return false;
    }
}

// Function to create a manual job from a CronJob
function createJobFromCronJob(cronJobName: string, namespace: string): string {
    // Generate the job name from the CronJob name with a timestamp suffix
    const jobName = `${cronJobName}-manual-${Date.now()}`;

    // Create the job using kubectl
    const createJobCommand = `uds zarf tools kubectl create job ${jobName} --from=cronjob/${cronJobName} -n ${namespace}`;
    
    try {
        const stdout = execSync(createJobCommand, { encoding: 'utf-8' });
        console.log('Job created successfully:', stdout);
        return jobName;
    } catch (error) {
        console.error('Error creating job:', error.message);
        throw new Error(`Failed to create job: ${error.message}`);
    }
}

// Function to wait until the job reaches a terminated state with a max wait time
function waitForJobCompletion(jobName: string, namespace: string, maxWaitTimeInSeconds: number): void {
    const checkJobStatusCommand = `uds zarf tools kubectl get job ${jobName} -n ${namespace} -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}'`;
    const pollingInterval = 5000; // Polling interval of 5 seconds
    let timeElapsed = 0;

    while (timeElapsed < maxWaitTimeInSeconds * 1000) {
        try {
            const stdout = execSync(checkJobStatusCommand, { encoding: 'utf-8' });
            if (stdout.includes('True')) {
                console.log(`Job ${jobName} has completed successfully.`);
                return; // Exit the function when job completes
            } else {
                console.log(`Job ${jobName} is still running, waiting...`);
            }
        } catch (error) {
            console.error('Error checking job status:', error.message);
        }

        // Wait for the next polling cycle (5 seconds)
        const start = Date.now();
        while (Date.now() - start < pollingInterval) {
            // Busy wait to simulate `setTimeout` in a synchronous context
        }

        timeElapsed += pollingInterval;
    }

    throw new Error(`Job ${jobName} did not complete within ${maxWaitTimeInSeconds} seconds.`);
}
