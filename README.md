# dsh-telegram-ru

**English** | [Русский](README.ru.md)

Control [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) through Telegram in English and Russian: projects, tasks, history and results in one menu.

Version `0.3.0` builds on [Gum97/dsh-telegram](https://github.com/Gum97/dsh-telegram) under the MIT license. The original integration was verified with Harness **0.2.1-alpha.2**, Node **25.2.1** and Undici **8.10.0**. The English localization and settings card were also checked on Harness **0.2.1-alpha.5**; this does not establish full compatibility with every feature of that version. Undici requires Node **22.19.0** or later. Other Harness versions have not been verified separately.

## Features

- Main menu and command descriptions in English and Russian.
- Select projects from Harness workspaces.
- Browse project tasks, their status and their last completed response.
- Continue existing conversations, including ones created in the Web UI.
- Create a new task while keeping the previous history.
- Select a model, a preset for a new task and permissions.
- Stop the current response and compact loaded conversation history.
- Settings → Telegram card in English and Russian.
- Preserve the upstream modules for images, documents, streaming responses, questions and approvals.

The completed list contains tasks whose last response ended normally. This describes the response state; it does not independently verify that the user's requirements were met. Errors, stopped responses and waiting states are shown separately.

## Installation

Install the plugin into an existing profile:

```sh
dsh plugin --profile web add github:seoeaa/dsh-telegram-ru#main
```

The `main` branch includes English and Russian localization. The older `v0.3.0` tag retains the Russian navigation from before the full English translation was added.

Add the **package name** `@local/dsh-telegram-ru` to `dsh.profile.bundles` in your profile's `package.json`. Keep your other bundles. Example for a basic Web profile:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@local/dsh-telegram-ru"
      ]
    }
  }
}
```

The name `@local/dsh-telegram-ru` is retained because the browser module loader also uses it. Installation uses GitHub; a package published under the same name on npm is not required.

If `dsh-telegram` is already connected, remove it from your profile's bundles and dependencies before connecting this fork. Only one Telegram poller may use a bot token at a time; otherwise Telegram returns a `409` conflict.

### Access and bot token

1. Create your own bot through `@BotFather`.
2. Before starting the bot, set your Telegram user ID and working directory in the profile's `cordis.patch.yml`:

```yaml
- id: telegram
  config:
    language: en
    allowedUsers:
      - "YOUR_TELEGRAM_USER_ID"
    workspaceRoot: /path/to/project
    forceIPv4: true
    proxyUrl: ""
```

Replace the ID and path with your own values. If needed, set `proxyUrl` to your HTTP proxy address. An empty value also allows the standard proxy environment variables to be used.

3. Start the Web profile and open **Settings → Telegram**. Save the bot token in its field. Harness writes it through its credentials service under the reference `TELEGRAM_BOT_TOKEN`; do not put the token in the plugin's YAML configuration or Git.
4. Restart the profile after configuring the token. Finish current tasks or deliberately stop them before restarting.
5. Send `/menu` in a private chat with your bot.

An empty `allowedUsers` list means the bot is unclaimed: the first person to send `/start` becomes its owner. Set your ID explicitly beforehand for a predictable installation. An authorized user can access the agent's tools according to its permissions.

## Usage

**Language:** open **Settings → Telegram → Language** in the Web UI, select **English** and press **Save**. The language applies to bot messages, project and task menus, statuses, models, presets, permissions and notifications without restarting Harness. Open a new `/menu` afterwards. Russian remains the default; project names, custom preset names and model responses are kept as supplied. Telegram's command list has an English default and separate `en`/`ru` versions selected by the Telegram client's language.

**Projects → project → Tasks → task card → Control this task** selects an existing conversation. A regular message continues it. **New task** creates a conversation in the selected working directory while keeping the old history.

**Completed → task card → View result** shows the full text of the last completed response. Long results are split into multiple messages. Task lists contain eight tasks per page; the completed menu filters the current page of the full history.

| Command | Action |
|---|---|
| `/menu`, `/start` | Main menu |
| `/projects` | Select a project |
| `/tasks` | Tasks in the selected project |
| `/done` | Completed responses |
| `/result` | Selected task result |
| `/new`, `/clear` | New conversation, keeping the previous one |
| `/model` | Select a model |
| `/preset` | Select a preset for the next new task |
| `/mode` | Selected task permissions |
| `/status` | Selected task state |
| `/stop` | Request to stop the current response |
| `/compact` | Compact a loaded conversation if its preset provides compaction |
| `/help` | List commands |

A model or permission change for an unloaded task is applied when that task resumes. A preset applies to the next new task. Menus expire after ten minutes and belong to a specific user, chat and topic. Open a new `/menu` after a restart or update.

## Verification and limitations

The English localization was checked separately with 28 local command scenarios across both languages, capturing outgoing messages; matching 207 English/Russian keys and their placeholders; callback ownership and replay checks; and tool activity and failure notifications. Chromium on Harness `0.2.1-alpha.5` verified the English option and English settings labels without JavaScript errors; the original Russian setting was preserved. The plugin was activated without restarting Harness. These checks sent no messages to users and did not run a model.

Earlier checks in a running Harness verified Bot API authentication, Russian default/ru commands, menu delivery, project and existing-task selection, result retrieval, model and preset menus, and model and permission changes. A short new task and continuation of the same saved session returned the expected response. Chromium verified Web loading, the Russian card, and reading and saving settings without errors.

For that earlier integration check, incoming updates and button presses were submitted programmatically to the plugin handler; outgoing messages used the real Bot API. This does not verify physical-phone interactions or an incoming update sent through the Telegram client. Stopping a busy agent, compacting a long history and all model providers have not been separately verified. No new unit tests were created.

CI checks JavaScript syntax and npm package contents. Private messages, history, tokens and personal settings are excluded from the repository.

## Development

Server modules are plain ESM JavaScript in `lib/`. `lib/client.js` is a prebuilt browser bundle with external React and Harness modules. This repository has no build step from TSX sources: edit and check the shipped module; there is no `build:client` script.

- `navigation.js` — projects, tasks, states, results and callbacks.
- `commands.js` — commands and agent setting choices.
- `index.js` — connection, incoming updates and session lifecycle.
- `settings.js`, `client.js` — Host and Web settings.
- `api.js` — Bot API, proxies, polling and delivery limits.
- `i18n.js` — message, command and navigation dictionaries.
- Other modules — media, replies, questions and approvals.

Check without contacting a bot:

```sh
for file in lib/*.js; do node --check "$file"; done
npm pack --dry-run
```

Before changing API integration, check the installed Harness version. Relevant integration points include the `agentPresets` service, `sessionController.selectModel`, `permissionPresets.set`, volatile Config and the browser package registration name. Use fetch and ProxyAgent from the same Undici version for proxy support.

## License

[MIT](LICENSE). Original author: Gum97. This repository maintains the Russian and English menus, shared project/task navigation and integration with the alpha versions described above.
