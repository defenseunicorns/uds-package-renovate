# Configuration

Renovate in this package is configured through the upstream [renovatebot chart](https://github.com/renovatebot/helm-charts) as well as a UDS configuration chart that supports the following:

## Scheduling

The schedule of the renovate cronjob is set using the Zarf variable `RENOVATE_SCHEDULE` using Kubernetes CronJob syntax.

By default the schedule is every 15 minutes (`"*/15 * * * *"`).

## Renovate application settings

- `renovate.logLevel` - Sets the log level for the renovate cronjob. See: https://github.com/renovatebot/renovate/blob/main/docs/usage/examples/self-hosting.md#logging
- `renovate.printconfig` - Enables printing the combined renovate config in the cronjob output. Useful for troubleshooting. Defaults to `true`. See: 
- `renovate.platform` - Platform type of repository. Defaults to `gitlab`. See https://docs.renovatebot.com/self-hosted-configuration/#platform
- `renovate.endpoint` - Endpoint to use for communication with the platform API. See https://docs.renovatebot.com/self-hosted-configuration/#endpoint
- `renovate.autodiscover` - Autodiscover repositories. Defaults to `true` which enables Renovate to run on all repositories that the bot account can access. See https://docs.renovatebot.com/self-hosted-configuration/#autodiscover
- `renovate.onboarding` - Require a configuration PR to onboard new repositories to Renovate. Defaults to `true`. See https://docs.renovatebot.com/self-hosted-configuration/#onboarding
- `renovate.extraEnv` - A map of key value pairs to pass extra environment variables to Renovate for custom configuration options. Any value listed in the [Renovate Self-Hosted configuration options](https://docs.renovatebot.com/self-hosted-configuration/) can be specified here using the `env` variable name from the docs. 
- `renovate.config` - Renovate `config.json` file represented in YAML (YAML keys are the same as those in the `config.json` and are converted toJson iby the template). The contents of this file will be combined with any settings or environment variables specified above. If `renovate.printconfig` is `true` the combined effective config will appear in the pod logs for each execution of Renovate.

## Redis

Renovate can optionally connect to a Redis instance to cache data between runs. The following settings control the use of Redis.

- `redis.enabled` - Whether or not to use Redis. The remaining settings only apply if set to `true`.
- `redis.internal` - Set to `true` to use redis in the cluster, or `false` to use an external redis.
- `redis.selector` - Used to set the selector for network policies if `redis.internal` is `true`.
- `redis.namespace` - Used to set the remoteNamespace for network policies if `redis.internal` is `true`.
- `redis.scheme` - The url scheme of the redis connection string. Defaults to `redis`.
- `redis.host` - The hostname to connect to.
- `redis.port` - The port to connect to.
- `redis.username` - The username to authenticate to redis. Leave as empty string for anonymous auth.
- `redis.password` - (Optional) The password to use to connect to Redis. If this is not specified, existingSecret is used.
- `redis.existingSecret.name` and `redis.existingSecret.passwordKey` - If specified, this will be used to look up an existing secret in the Release namespace to find the Redis password.

## Platform API Token

Renovate needs an API Token to communicate with the Gitlab or other platform API. This is specified using one of the following options.

- `platformToken.value` -- If specified, will be used directly. If not specified, existingSecret is used.
- `platformToken.existingSecret.name` and `platformToken.existingSecret.tokenKey` -- If specified, this will be used to look up an existing secret in the Release namespace to find the token.