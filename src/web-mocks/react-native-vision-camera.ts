import React from 'react';

export const Camera = (props: any) => {
  return React.createElement('div', {
    style: {
      width: '100%',
      height: '100%',
      backgroundColor: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
    }
  }, 'Web Camera View');
};

export const useCameraDevice = (position: string) => {
  return {
    id: 'mock-camera-device-id',
    position,
    name: 'Mock Web Camera',
  };
};

export default {
  Camera,
  useCameraDevice,
};
