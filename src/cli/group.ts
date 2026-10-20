import { GrammyError, type Api } from 'grammy';
import type { ChatMember } from 'grammy/types';
import { CliError } from './errors.js';

export interface GroupCheck {
  title: string;
  botStatus: ChatMember['status'];
}

/** Asks Telegram live for the group's title and the bot's status there. */
export async function checkGroup(api: Api, chatId: number): Promise<GroupCheck> {
  const me = await api.getMe();
  const chat = await api.getChat(chatId);
  const member = await api.getChatMember(chatId, me.id);
  return { title: 'title' in chat && chat.title ? chat.title : String(chatId), botStatus: member.status };
}

/** For create and edit: the bot must be an admin in the group. Returns the group's title. */
export async function requireBotAdmin(api: Api, chatId: number): Promise<string> {
  let check: GroupCheck;
  try {
    check = await checkGroup(api, chatId);
  } catch (err) {
    if (err instanceof GrammyError) throw new CliError(`could not check group ${chatId}: ${err.description}`);
    throw err;
  }
  if (check.botStatus !== 'administrator') {
    throw new CliError(
      `the bot is not an admin in ${chatId} “${check.title}” (its status is ${check.botStatus}); promote it first`,
    );
  }
  return check.title;
}
