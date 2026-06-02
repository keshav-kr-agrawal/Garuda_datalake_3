// Custom mock for react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  
  const AnimatedView = (props) => React.createElement(View, props);
  const AnimatedText = (props) => React.createElement(Text, props);

  return {
    useSharedValue: (val) => ({ value: val }),
    useAnimatedStyle: (callback) => callback() || {},
    withSpring: (val) => val,
    withRepeat: (val) => val,
    withSequence: (...vals) => vals[0],
    withTiming: (val) => val,
    interpolateColor: (val, input, output) => output[0],
    default: {
      View: AnimatedView,
      Text: AnimatedText,
    },
  };
});

// Mock react-native-vision-camera JNI ESM module
jest.mock('react-native-vision-camera', () => {
  return {
    Camera: 'Camera',
    useCameraDevice: jest.fn(() => ({ id: 'front', position: 'front' })),
    getCameraPermissionStatus: jest.fn(async () => 'granted'),
    requestCameraPermission: jest.fn(async () => 'granted'),
  };
});

// Mock react-native-svg elements
jest.mock('react-native-svg', () => ({
  default: 'Svg',
  Svg: 'Svg',
  Circle: 'Circle',
  Rect: 'Rect',
}));

// Mock react-native-fast-tflite JNI binary bridging
jest.mock('react-native-fast-tflite', () => ({
  loadTensorFlowModel: jest.fn(async () => ({ mock: true })),
}));

// Mock AsyncStorage key-value offline engines
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key) => store[key] || null),
      setItem: jest.fn(async (key, val) => {
        store[key] = val;
        return null;
      }),
      removeItem: jest.fn(async (key) => {
        delete store[key];
        return null;
      }),
      clear: jest.fn(async () => {
        for (const k in store) delete store[k];
        return null;
      }),
    },
  };
});

// Mock NetInfo connectivity state changes
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((callback) => {
    callback({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    return () => {};
  }),
}));
