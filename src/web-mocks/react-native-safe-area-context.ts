import React from 'react';

export const SafeAreaProvider = ({ children }: any) => {
  return React.createElement('div', {
    style: {
      width: '100vw',
      height: '100vh',
      margin: 0,
      padding: 0,
      boxSizing: 'border-box',
    }
  }, children);
};

export const SafeAreaView = ({ children, style, ...props }: any) => {
  return React.createElement('div', {
    style: {
      flex: 1,
      paddingTop: '20px',
      paddingBottom: '20px',
      ...style
    },
    ...props
  }, children);
};

export const useSafeAreaInsets = () => {
  return { top: 20, right: 0, bottom: 20, left: 0 };
};

export default {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
};
