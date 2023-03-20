#!/usr/bin/env node

/*!
 * TeleGPT
 * Copyright (c) 2023
 *
 * @author Zubin
 * @username (GitHub) losparviero
 * @license AGPL-3.0
 */

// Add env vars as a preliminary

import dotenv from "dotenv";
dotenv.config();
import { Bot, session, GrammyError } from "grammy";
import { hydrateReply, parseMode } from "@grammyjs/parse-mode";
import { run, sequentialize } from "@grammyjs/runner";
import { hydrate } from "@grammyjs/hydrate";
import { ChatGPTClient } from "@waylaidwanderer/chatgpt-api";

// Bot

const bot = new Bot(process.env.BOT_TOKEN);

// Auth

const clientOptions = {
  modelOptions: {
    model: "gpt-3.5-turbo",
  },
};

const chatGptClient = new ChatGPTClient(process.env.API_KEY, clientOptions);

// Concurrency

function getSessionKey(ctx) {
  return ctx.chat?.id.toString();
}

// Plugins

bot.use(sequentialize(getSessionKey));
bot.use(session({ getSessionKey }));
bot.use(responseTime);
bot.use(log);
bot.use(admin);
bot.use(hydrate());
bot.use(hydrateReply);

// Parse

bot.api.config.use(parseMode("Markdown"));

// Admin

const admins = process.env.BOT_ADMIN?.split(",").map(Number) || [];
async function admin(ctx, next) {
  ctx.config = {
    botAdmins: admins,
    isAdmin: admins.includes(ctx.chat?.id),
  };
  await next();
}

// Response

async function responseTime(ctx, next) {
  const before = Date.now();
  await next();
  const after = Date.now();
  console.log(`Response time: ${after - before} ms`);
}

// Log

async function log(ctx, next) {
  const from = ctx.from;
  const name =
    from.last_name === undefined
      ? from.first_name
      : `${from.first_name} ${from.last_name}`;
  console.log(
    `From: ${name} (@${from.username}) ID: ${from.id}\nMessage: ${ctx.message.text}`
  );

  const msgText = ctx.message.text;

  if (!msgText.includes("/") && !admins.includes(ctx.chat?.id)) {
    await bot.api.sendMessage(
      process.env.BOT_ADMIN,
      `<b>From: ${ctx.from.first_name} (@${ctx.from.username}) ID: <code>${ctx.from.id}</code></b>`,
      { parse_mode: "HTML" }
    );
    await ctx.api.forwardMessage(
      process.env.BOT_ADMIN,
      ctx.chat.id,
      ctx.message.message_id
    );
  }

  await next();
}

// Commands

bot.command("start", async (ctx) => {
  await ctx
    .reply("*Welcome!* ✨\n_Send any query or ask questions._", {
      parse_mode: "Markdown",
    })
    .then(console.log("New user added:\n", ctx.from))
    .catch((e) => console.log(e));
});

bot.command("help", async (ctx) => {
  await ctx
    .reply(
      "*@anzubo Project.*\n\n_This is a chat bot using OpenAI's Chat API.\nAsk any query to get started!_",
      { parse_mode: "Markdown" }
    )
    .then(console.log("Help command sent to", ctx.chat.id))
    .catch((e) => console.log(e));
});

bot.on("message", async (ctx) => {
  const statusMessage = await ctx.reply(`*Processing*`);
  let response;

  try {
    async function requestApi(ctx) {
      try {
        const resultPromise = await chatGptClient.sendMessage(ctx.message.text);

        const result = await Promise.race([
          resultPromise,
          new Promise((_, reject) => {
            setTimeout(() => {
              reject("Function timeout");
            }, 60000);
          }),
        ]);

        console.log(result.details.usage);
        await ctx.reply(result.response, {
          reply_to_message_id: ctx.message.message_id,
        });
      } catch (error) {
        if (error === "Function timeout") {
          await ctx.reply("*Query timed out.*", {
            reply_to_message_id: ctx.message.message_id,
          });
        } else {
          throw error;
        }
      }
    }

    await requestApi(ctx);

    await statusMessage.delete();
  } catch (error) {
    if (error instanceof GrammyError) {
      if (error.message.includes("Forbidden: bot was blocked by the user")) {
        console.log("Bot was blocked by the user");
      } else if (error.message.includes("Call to 'sendMessage' failed!")) {
        console.log("Error sending message: ", error);
        await ctx.reply(`*Error contacting Telegram.*`, {
          reply_to_message_id: ctx.message.message_id,
        });
      } else {
        await ctx.reply(`*An error occurred: ${error.message}*`, {
          reply_to_message_id: ctx.message.message_id,
        });
      }
      console.log(`Error sending message: ${error.message}`);
      return;
    } else {
      console.log(`An error occurred:`, error);
      await ctx.reply(`*An error occurred.*\n_Error: ${error.message}_`, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }
  }
});

// Run

run(bot);