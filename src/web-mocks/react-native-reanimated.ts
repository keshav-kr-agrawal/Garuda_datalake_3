export const useSharedValue = (initialValue: any) => {
  return { value: initialValue };
};

export const useAnimatedStyle = (styleFn: any) => {
  return styleFn();
};

export const withSpring = (value: any) => value;
export const withRepeat = (animation: any, numberOfReps?: number, reverse?: boolean) => animation;
export const withSequence = (...animations: any[]) => animations[0];
export const withTiming = (toValue: any, userConfig?: any, callback?: any) => toValue;
export const interpolateColor = (value: number, inputRange: number[], outputRange: string[]) => {
  // Simple fallback
  if (value <= inputRange[0]) return outputRange[0];
  if (value >= inputRange[inputRange.length - 1]) return outputRange[outputRange.length - 1];
  return outputRange[1] || outputRange[0];
};

export default {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  interpolateColor,
};
