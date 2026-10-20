// Scheme 16 mark: one stroke writes AN. The plated app icon stays in assets/icon.png.
// In-app slots use the theme mark. At 32px and below the kit drops the end dots and thickens the stroke.
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { themeMode } from './theme';

const LIGHT = require('../assets/mark-light.png');
const DARK = require('../assets/mark-dark.png');
const LIGHT_SMALL = require('../assets/mark-small-light.png');
const DARK_SMALL = require('../assets/mark-small-dark.png');

export function BrandMark({ size, style }: { size: number; style?: StyleProp<ImageStyle> }) {
  const dark = themeMode() === 'dark';
  const small = size <= 32;
  const source = small ? (dark ? DARK_SMALL : LIGHT_SMALL) : (dark ? DARK : LIGHT);
  return (
    <Image
      source={source}
      style={[{ width: size, height: size, alignSelf: 'center' }, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}
