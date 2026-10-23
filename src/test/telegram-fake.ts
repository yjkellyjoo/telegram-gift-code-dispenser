import type { Transformer } from 'grammy';
import type { ChatFullInfo, ChatMember, Message, User, UserFromGetMe } from 'grammy/types';

export type MemberStatus = ChatMember['status'];
export type Failure = { error_code: number; description: string } | Error;

export interface Sent {
  chatId: number;
  text: string;
  parseMode: string | undefined;
  linkPreview: unknown;
  replyMarkup: unknown;
}

/** Complete, real-shaped ChatMember objects, typed by grammY so no required field is missing. */
export function chatMember(status: MemberStatus, user: User): ChatMember {
  switch (status) {
    case 'creator':
      return { status, user, is_anonymous: false };
    case 'administrator':
      return {
        status, user, can_be_edited: false, is_anonymous: false, can_manage_chat: true,
        can_delete_messages: false, can_manage_video_chats: false, can_restrict_members: false,
        can_promote_members: false, can_change_info: false, can_invite_users: false,
        can_post_stories: false, can_edit_stories: false, can_delete_stories: false,
        can_send_welcome_messages: false,
      };
    case 'member':
      return { status, user };
    case 'restricted':
      return {
        status, user, is_member: true, can_send_messages: false, can_send_audios: false,
        can_send_documents: false, can_send_photos: false, can_send_videos: false,
        can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
        can_send_other_messages: false, can_add_web_page_previews: false, can_react_to_messages: false,
        can_change_info: false, can_invite_users: false, can_edit_tag: false, can_pin_messages: false,
        can_manage_topics: false, until_date: 0,
      };
    case 'left':
      return { status, user };
    case 'kicked':
      return { status, user, until_date: 0 };
  }
}

/**
 * Stands in for the Bot API at grammY's transport. Records what users would see and
 * answers the methods the dispenser calls. Unknown methods throw, so nothing goes unnoticed.
 */
export class TelegramFake {
  readonly botInfo: UserFromGetMe;
  readonly sent: Sent[] = [];
  readonly callbackAnswers: Array<{ id: string; text: string | undefined }> = [];
  readonly leftChats: number[] = [];
  groupTitle = 'Swarm booth chat';
  private readonly statuses = new Map<string, MemberStatus>();
  private readonly failures = new Map<string, Failure[]>();

  constructor(botId: number, groupId: number) {
    this.botInfo = {
      id: botId, is_bot: true, first_name: 'Gift Dispenser', username: 'gift_dispenser_test_bot',
      can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
      allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false,
    };
    this.setStatus(groupId, botId, 'administrator');
  }

  /** Users default to `member` everywhere; set anything else here. */
  setStatus(chatId: number, userId: number, status: MemberStatus): void {
    this.statuses.set(`${chatId}:${userId}`, status);
  }

  /** The next call to `method` fails: with a Telegram error, or by throwing (a network failure). */
  failNext(method: string, failure: Failure): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), failure]);
  }

  textsTo(chatId: number): string[] {
    return this.sent.filter((s) => s.chatId === chatId).map((s) => s.text);
  }

  readonly transformer: Transformer = async (_prev, method, payload) => {
    const failure = this.failures.get(method)?.shift();
    if (failure instanceof Error) throw failure;
    if (failure) return { ok: false, ...failure };
    return { ok: true, result: this.answer(method, payload as Record<string, unknown>) as never };
  };

  private answer(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'getMe':
        return this.botInfo;
      case 'getChat':
        return {
          id: Number(p.chat_id), type: 'supergroup', title: this.groupTitle, accent_color_id: 0,
          max_reaction_count: 11,
          accepted_gift_types: {
            unlimited_gifts: false, limited_gifts: false, unique_gifts: false,
            premium_subscription: false, gifts_from_channels: false,
          },
        } satisfies ChatFullInfo.SupergroupChat;
      case 'getChatMember': {
        const userId = Number(p.user_id);
        const status = this.statuses.get(`${Number(p.chat_id)}:${userId}`) ?? 'member';
        return chatMember(status, { id: userId, is_bot: userId === this.botInfo.id, first_name: `User${userId}` });
      }
      case 'sendMessage': {
        const chatId = Number(p.chat_id);
        const text = String(p.text);
        this.sent.push({
          chatId, text, parseMode: p.parse_mode as string | undefined, linkPreview: p.link_preview_options,
          replyMarkup: p.reply_markup,
        });
        return {
          message_id: this.sent.length, date: 1_794_650_400,
          chat: { id: chatId, type: 'private', first_name: `User${chatId}` }, text,
        } satisfies Message.TextMessage;
      }
      case 'answerCallbackQuery':
        this.callbackAnswers.push({ id: String(p.callback_query_id), text: p.text as string | undefined });
        return true;
      case 'leaveChat':
        this.leftChats.push(Number(p.chat_id));
        return true;
      default:
        throw new Error(`TelegramFake does not implement ${method}`);
    }
  }
}
