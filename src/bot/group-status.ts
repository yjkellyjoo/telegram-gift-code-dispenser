import type { Api } from 'grammy';
import type { ChatMember, ChatMemberUpdated } from 'grammy/types';
import { getEvent } from '../store/events.js';
import { notifyAdmin } from './claim-flow.js';
import type { Flow } from './flow.js';

const present = (status: ChatMember['status']): boolean => status === 'member' || status === 'administrator';

/** Spec §6.4: report the group ID to the admin; leave any group someone else added the bot to. */
export async function handleGroupStatus(api: Api, flow: Flow, update: ChatMemberUpdated): Promise<void> {
  const { chat, from } = update;
  if (chat.type !== 'group' && chat.type !== 'supergroup') return;
  if (from.id === flow.botId) return;

  const before = update.old_chat_member.status;
  const after = update.new_chat_member.status;
  const byAdmin = from.id === flow.adminUserId;
  const isEventGroup = getEvent(flow.db)?.groupChatId === chat.id;
  const addedByOther = !byAdmin && !present(before) && present(after);
  const lines: string[] = [];

  if (addedByOther) {
    flow.log.warn('added to a group by someone else; leaving', { chat: chat.id, by: from.id });
    await api.leaveChat(chat.id);
    if (!isEventGroup) return;
    lines.push(`Someone else added me to “${chat.title}” (ID ${chat.id}), so I left. Add me yourself.`);
  } else if (byAdmin && after === 'administrator') {
    lines.push(`I'm now an admin in “${chat.title}” (ID ${chat.id}).`, `Use it as: dispenser event create --group=${chat.id} …`);
  } else if (byAdmin && after === 'member') {
    lines.push(`I'm now a member of “${chat.title}” (ID ${chat.id}). Make me an admin so I can check membership.`);
  } else if (isEventGroup) {
    lines.push(`My status in “${chat.title}” (ID ${chat.id}) is now ${after}.`);
  } else {
    return;
  }

  const adminAfter = after === 'administrator' && !addedByOther;
  if (isEventGroup && !adminAfter) {
    lines.push('The group check fails, and nobody can claim, until you make me an admin again.');
  }
  await notifyAdmin(api, flow, lines.join('\n'));
}
