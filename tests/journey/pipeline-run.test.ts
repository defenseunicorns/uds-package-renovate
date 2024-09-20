import { expect, test} from '@jest/globals';
import { K8s, kind } from "kubernetes-fluent-client";
import { zarfExec, retry } from "../common";
import * as path from 'path';
import { execSync } from 'child_process';
import { rm } from 'fs/promises';

const domainSuffix = process.env.DOMAIN_SUFFIX || ".uds.dev"

test('upload archivista', async () => {
    const sourceRepoName = 'archivista'
    const user = 'doug'
    const nowMillis = Date.now()
    var sourceDir = path.join(__dirname, 'repo-sources', sourceRepoName)

    const token = await getToken(user);
    console.log(`Using token [${token}] for user [${user}]`)
    const headers: HeadersInit = [["PRIVATE-TOKEN", token]]

    // upload project once and invite renovate
    const gitLabProjectName = `${sourceRepoName}-${nowMillis}`
    const projectId = await createNewGitlabProject(sourceDir, user, token, gitLabProjectName, headers)
    await inviteRenovateBotToProject(headers, projectId, token);

    // // upload same project again under a different name and don't invite renovate
    const gitLabProjectName2 = `${sourceRepoName}-${nowMillis}-2`
    const projectId2 = await createNewGitlabProject(sourceDir, user, token, gitLabProjectName2, headers)

    // kick off a manual renovate run and wait for it
    const jobName=await createJobFromCronJob('renovate', 'renovate')
    await waitForJobCompletion(jobName, 'renovate', 60)

    // check that project 1 got a merge request
    var mergeRequest1Found = await findMergeRequest(token, projectId, 'renovatebot', 'Configure Renovate')
    expect(mergeRequest1Found).toBe(true)

    // check that project 2 did not get a merge request
    var mergeRequest2Found = await findMergeRequest(token, projectId2, 'renovatebot', 'Configure Renovate')
    expect(mergeRequest2Found).toBe(false)
}, 90000);


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

        console.log(mergeRequests)

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