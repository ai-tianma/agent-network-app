import { useState } from 'react';
import { Image, View } from 'react-native';
import { Text } from './ui-text';
import type { Human } from './human-dm';
import { humanAvatarPlan } from './human-avatar';
import { sourceForFile } from './lib/avatars';
import { avatarRadius, colors } from './theme';
import { ds } from './ui-scale';
import UserAvatarImage from './UserAvatarImage';

export default function HumanAvatar({ hubUrl, token, person, size = 32, fixedSize = false, testID }: {
  hubUrl: string; token?: string; person: Human; size?: number; fixedSize?: boolean; testID?: string;
}) {
  const plan = humanAvatarPlan(person.user_id, person.avatar_url);
  // Remount image/error state on identity or URL changes: a late error from the
  // previous Hub/user/image must not hide the newly selected person's image.
  return <Picture key={JSON.stringify([hubUrl, token, person.user_id, plan])} plan={plan} hubUrl={hubUrl} token={token}
    name={person.display_name || person.username} size={fixedSize ? size : ds(size)} testID={testID} />;
}

function Picture({ plan, name, size, testID, hubUrl, token }: {
  plan: ReturnType<typeof humanAvatarPlan>; name: string; size: number; testID?: string; hubUrl: string; token?: string;
}) {
  const [failed, setFailed] = useState(false);
  const source = plan && ('file' in plan ? sourceForFile(plan.file) : plan);
  return <View testID={testID} style={{ width: size, height: size, borderRadius: avatarRadius(size),
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.rowHover }}>
    <Text fixedSize style={{ color: colors.text, fontSize: Math.max(10, Math.round(size * 0.42)) }}>
      {Array.from(name.trim())[0]?.toUpperCase() || '·'}
    </Text>
    {source && !failed && plan && 'uri' in plan ? <UserAvatarImage value={plan.uri} hubUrl={hubUrl} token={token}
      testID={testID ? `${testID}-image` : undefined} onError={() => setFailed(true)}
      style={{ position: 'absolute', width: size, height: size, borderRadius: avatarRadius(size) }} /> : source && !failed ? <Image testID={testID ? `${testID}-image` : undefined} source={source}
      onError={() => setFailed(true)} style={{ position: 'absolute', width: size, height: size, borderRadius: avatarRadius(size) }} /> : null}
  </View>;
}
