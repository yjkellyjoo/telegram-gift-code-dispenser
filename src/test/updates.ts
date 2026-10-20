import type { Chat, Update, User } from 'grammy/types';
import { chatMember, type MemberStatus } from './telegram-fake.js';

const DATE = 1_794_650_400;
let lastId = 0;

export const userOf = (id: number): User => ({ id, is_bot: false, first_name: `User${id}` });
export const privateChat = (id: number): Chat.PrivateChat => ({ id, type: 'private', first_name: `User${id}` });
export const supergroup = (id: number, title: string): Chat.SupergroupChat => ({ id, type: 'supergroup', title });

type MessageChat = Chat.PrivateChat | Chat.GroupChat | Chat.SupergroupChat;

export function textUpdate(from: number, text: string, chat: MessageChat = privateChat(from)): Update {
  lastId += 1;
  const command = /^\/\w+/.exec(text)?.[0];
  return {
    update_id: lastId,
    message: {
      message_id: lastId, date: DATE, chat, from: userOf(from), text,
      ...(command ? { entities: [{ type: 'bot_command', offset: 0, length: command.length }] } : {}),
    },
  };
}

export function locationUpdate(from: number): Update {
  lastId += 1;
  return {
    update_id: lastId,
    message: {
      message_id: lastId, date: DATE, chat: privateChat(from), from: userOf(from),
      location: { latitude: 52.52, longitude: 13.405 },
    },
  };
}

export function callbackUpdate(from: number, data: string, chat: MessageChat = privateChat(from)): Update {
  lastId += 1;
  return {
    update_id: lastId,
    callback_query: {
      id: `cb${lastId}`, from: userOf(from), chat_instance: 'chat-instance', data,
      message: { message_id: 1, date: DATE, chat, from: userOf(777000), text: 'Did you upload your first file?' },
    },
  };
}

export function botStatusUpdate(options: {
  chat: Chat.SupergroupChat;
  by: number;
  botId: number;
  from: MemberStatus;
  to: MemberStatus;
}): Update {
  lastId += 1;
  const bot: User = { id: options.botId, is_bot: true, first_name: 'Gift Dispenser' };
  return {
    update_id: lastId,
    my_chat_member: {
      chat: options.chat, from: userOf(options.by), date: DATE,
      old_chat_member: chatMember(options.from, bot), new_chat_member: chatMember(options.to, bot),
    },
  };
}
