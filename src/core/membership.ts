import type { ChatMember } from 'grammy/types';

export type Membership = 'member' | 'restricted' | 'not_member';

/**
 * `restricted` never passes, even with is_member = true: Rose's captcha mutes new members
 * until they solve it, so an unverified account is restricted.
 */
export function classifyMember(member: ChatMember): Membership {
  switch (member.status) {
    case 'creator':
    case 'administrator':
    case 'member':
      return 'member';
    case 'restricted':
      return 'restricted';
    default:
      return 'not_member';
  }
}
