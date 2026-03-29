import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { resolvePikachatClaudeConfig } from "./config.js";
import { PikachatClaudeChannel } from "./channel-runtime.js";

const config = resolvePikachatClaudeConfig(process.env);

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

const mcp = new Server(
  { name: config.channelSource, version: "0.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions:
      `Messages arrive as <channel source="${config.channelSource}" chat_id="..." sender_id="..." event_id="..." chat_type="direct|group">...</channel>. ` +
      `Reply with the reply tool, passing the chat_id from the tag. ` +
      `React with the react tool, passing chat_id and event_id from the tag. ` +
      `Unknown direct-message senders may require the approve_pairing tool before their messages will be delivered.`,
  },
);

const runtime = new PikachatClaudeChannel({
  config,
  logger: {
    debug: (message) => log(message),
    info: (message) => log(message),
    warn: (message) => log(message),
    error: (message) => log(message),
  },
  onNotification: async ({ content, meta }) => {
    try {
      await mcp.notification({
        method: "notifications/claude/channel",
        params: {
          content,
          meta,
        },
      });
    } catch (err) {
      log(
        `[pikachat-claude] failed to forward notification chat_id=${meta.chat_id ?? "unknown"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

function requireNonEmptyString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing or invalid '${key}'`);
  }
  return value.trim();
}

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Send a text reply and optional files back through pikachat.",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: { type: "string", description: "Target chat/group ID from the channel tag" },
          text: { type: "string", description: "Reply text" },
          reply_to: { type: "string", description: "Optional inbound event/message ID to reply to" },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Absolute file paths to send as attachments",
          },
        },
        required: ["chat_id"],
      },
    },
    {
      name: "react",
      description: "React to a message by event ID.",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: { type: "string" },
          event_id: { type: "string" },
          emoji: { type: "string" },
        },
        required: ["chat_id", "event_id", "emoji"],
      },
    },
    {
      name: "access_status",
      description: "Show current DM policy, sender allowlist, groups, and pending pairings.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "approve_pairing",
      description: "Approve a pending DM pairing code and add the sender to the allowlist.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string" },
        },
        required: ["code"],
      },
    },
    {
      name: "deny_pairing",
      description: "Deny a pending DM pairing code.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string" },
        },
        required: ["code"],
      },
    },
    {
      name: "set_dm_policy",
      description: "Set DM policy to pairing, allowlist, or disabled.",
      inputSchema: {
        type: "object",
        properties: {
          policy: { type: "string", enum: ["pairing", "allowlist", "disabled"] },
        },
        required: ["policy"],
      },
    },
    {
      name: "allow_sender",
      description: "Add a sender pubkey to the DM allowlist.",
      inputSchema: {
        type: "object",
        properties: {
          sender_id: { type: "string" },
        },
        required: ["sender_id"],
      },
    },
    {
      name: "remove_sender",
      description: "Remove a sender pubkey from the DM allowlist.",
      inputSchema: {
        type: "object",
        properties: {
          sender_id: { type: "string" },
        },
        required: ["sender_id"],
      },
    },
    {
      name: "enable_group",
      description: "Enable a group and optionally require mentions and restrict allowed senders.",
      inputSchema: {
        type: "object",
        properties: {
          group_id: { type: "string" },
          require_mention: { type: "boolean" },
          allow_from: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["group_id"],
      },
    },
    {
      name: "disable_group",
      description: "Disable a group from delivering inbound messages.",
      inputSchema: {
        type: "object",
        properties: {
          group_id: { type: "string" },
        },
        required: ["group_id"],
      },
    },
    {
      name: "create_group",
      description:
        "Create a new encrypted group with a peer.",
      inputSchema: {
        type: "object",
        properties: {
          peer_pubkey: {
            type: "string",
            description: "Nostr npub or hex pubkey of the peer",
          },
          group_name: {
            type: "string",
            description: "Optional group name",
          },
        },
        required: ["peer_pubkey"],
      },
    },
    {
      name: "add_members",
      description: "Add one or more peers to an existing group.",
      inputSchema: {
        type: "object",
        properties: {
          group_id: {
            type: "string",
            description: "The nostr_group_id of the group",
          },
          peer_pubkeys: {
            type: "array",
            items: { type: "string" },
            description: "Nostr npubs or hex pubkeys of peers to add",
          },
        },
        required: ["group_id", "peer_pubkeys"],
      },
    },
    {
      name: "list_groups",
      description: "List all groups this agent belongs to.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_members",
      description: "List members of a group.",
      inputSchema: {
        type: "object",
        properties: {
          group_id: {
            type: "string",
            description: "The nostr_group_id of the group",
          },
        },
        required: ["group_id"],
      },
    },
    {
      name: "get_messages",
      description: "Fetch recent messages from a group.",
      inputSchema: {
        type: "object",
        properties: {
          group_id: {
            type: "string",
            description: "The nostr_group_id of the group",
          },
          limit: {
            type: "number",
            description: "Maximum number of messages to return (default 50)",
          },
        },
        required: ["group_id"],
      },
    },
    {
      name: "list_welcomes",
      description: "List pending group invitations.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "accept_welcome",
      description: "Accept a pending group invitation by its wrapper event ID.",
      inputSchema: {
        type: "object",
        properties: {
          wrapper_event_id: {
            type: "string",
            description: "The wrapper_event_id from list_welcomes",
          },
        },
        required: ["wrapper_event_id"],
      },
    },
    {
      name: "send_typing",
      description: "Send a typing indicator to a group.",
      inputSchema: {
        type: "object",
        properties: {
          group_id: {
            type: "string",
            description: "The nostr_group_id of the group",
          },
        },
        required: ["group_id"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  switch (request.params.name) {
    case "reply": {
      const result = await runtime.reply({
        chatId: requireNonEmptyString(args, "chat_id"),
        text: typeof args.text === "string" ? args.text : undefined,
        replyTo: typeof args.reply_to === "string" ? args.reply_to : undefined,
        files: Array.isArray(args.files) ? args.files.map((entry) => String(entry)) : undefined,
      });
      const notes = result.notes.length > 0 ? ` notes=${JSON.stringify(result.notes)}` : "";
      return textResult(`sent${notes}`);
    }
    case "react": {
      await runtime.react({
        chatId: requireNonEmptyString(args, "chat_id"),
        eventId: requireNonEmptyString(args, "event_id"),
        emoji: requireNonEmptyString(args, "emoji"),
      });
      return textResult("reaction sent");
    }
    case "access_status": {
      return textResult(JSON.stringify(await runtime.accessStatus(), null, 2));
    }
    case "approve_pairing": {
      const result = await runtime.approvePairing(requireNonEmptyString(args, "code"));
      return textResult(result.senderId ? `approved ${result.senderId}` : "pairing code not found");
    }
    case "deny_pairing": {
      const result = await runtime.denyPairing(requireNonEmptyString(args, "code"));
      return textResult(result.senderId ? `denied ${result.senderId}` : "pairing code not found");
    }
    case "set_dm_policy": {
      const policy = String(args.policy ?? "");
      if (policy !== "pairing" && policy !== "allowlist" && policy !== "disabled") {
        throw new Error(`invalid policy: ${policy}`);
      }
      return textResult(JSON.stringify(await runtime.setDmPolicy(policy), null, 2));
    }
    case "allow_sender": {
      return textResult(JSON.stringify(await runtime.allowSender(requireNonEmptyString(args, "sender_id")), null, 2));
    }
    case "remove_sender": {
      return textResult(
        JSON.stringify(await runtime.removeSender(requireNonEmptyString(args, "sender_id")), null, 2),
      );
    }
    case "enable_group": {
      return textResult(
        JSON.stringify(
          await runtime.enableGroup(
            requireNonEmptyString(args, "group_id"),
            args.require_mention !== false,
            Array.isArray(args.allow_from) ? args.allow_from.map((entry) => String(entry)) : [],
          ),
          null,
          2,
        ),
      );
    }
    case "disable_group": {
      return textResult(JSON.stringify(await runtime.disableGroup(requireNonEmptyString(args, "group_id")), null, 2));
    }
    case "create_group": {
      const result = await runtime.createGroup(
        requireNonEmptyString(args, "peer_pubkey"),
        typeof args.group_name === "string" ? args.group_name : undefined,
      );
      return textResult(JSON.stringify(result, null, 2));
    }
    case "add_members": {
      const peerPubkeys = args.peer_pubkeys;
      if (!Array.isArray(peerPubkeys) || peerPubkeys.length === 0) {
        throw new Error("peer_pubkeys must be a non-empty array");
      }
      const result = await runtime.addMembers(
        requireNonEmptyString(args, "group_id"),
        peerPubkeys.map((entry) => String(entry)),
      );
      return textResult(JSON.stringify(result, null, 2));
    }
    case "list_groups": {
      return textResult(JSON.stringify(await runtime.listGroups(), null, 2));
    }
    case "list_members": {
      return textResult(
        JSON.stringify(await runtime.listMembers(requireNonEmptyString(args, "group_id")), null, 2),
      );
    }
    case "get_messages": {
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      return textResult(
        JSON.stringify(await runtime.getMessages(requireNonEmptyString(args, "group_id"), limit), null, 2),
      );
    }
    case "list_welcomes": {
      return textResult(JSON.stringify(await runtime.listWelcomes(), null, 2));
    }
    case "accept_welcome": {
      await runtime.acceptWelcome(requireNonEmptyString(args, "wrapper_event_id"));
      return textResult("welcome accepted");
    }
    case "send_typing": {
      await runtime.sendTyping(requireNonEmptyString(args, "group_id"));
      return textResult("typing indicator sent");
    }
    default:
      throw new Error(`unknown tool: ${request.params.name}`);
  }
});

async function main(): Promise<void> {
  await runtime.start();
  await mcp.connect(new StdioServerTransport());
}

void main().catch(async (err) => {
  log(`[pikachat-claude] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  try {
    await runtime.stop();
  } catch (stopErr) {
    log(`[pikachat-claude] stop failed: ${stopErr instanceof Error ? stopErr.message : String(stopErr)}`);
  }
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void runtime.stop().finally(() => process.exit(0));
  });
}
