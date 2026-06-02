import React from 'react';

export const View = ({ children, style, ...props }: any) => {
  return React.createElement('div', { style: getWebStyles(style), ...props }, children);
};

export const Text = ({ children, style, ...props }: any) => {
  return React.createElement('span', { style: getWebStyles(style), ...props }, children);
};

export const TouchableOpacity = ({ children, style, onPress, ...props }: any) => {
  return React.createElement('button', {
    style: {
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      outline: 'none',
      padding: 0,
      fontFamily: 'inherit',
      ...getWebStyles(style)
    },
    onClick: onPress,
    ...props
  }, children);
};

export const ScrollView = ({ children, contentContainerStyle, style, ...props }: any) => {
  return React.createElement('div', {
    style: {
      overflowY: 'auto',
      maxHeight: '100%',
      ...getWebStyles(style),
      ...getWebStyles(contentContainerStyle)
    },
    ...props
  }, children);
};

export const SafeAreaView = ({ children, style, ...props }: any) => {
  return React.createElement('div', { style: getWebStyles(style), ...props }, children);
};

export const ActivityIndicator = ({ size, color }: any) => {
  return React.createElement('div', {
    style: {
      display: 'inline-block',
      width: size === 'large' ? '40px' : '20px',
      height: size === 'large' ? '40px' : '20px',
      border: `4px solid ${color || '#3b82f6'}`,
      borderTopColor: 'transparent',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
    }
  });
};

export const StyleSheet = {
  create: (styles: any) => styles,
};

export const Dimensions = {
  get: (type: string) => {
    return {
      width: typeof window !== 'undefined' ? window.innerWidth : 1024,
      height: typeof window !== 'undefined' ? window.innerHeight : 768,
    };
  }
};

export const Alert = {
  alert: (title: string, message?: string, buttons?: any[]) => {
    console.log(`Alert: ${title} - ${message}`);
    // Delay slightly to prevent blocking React execution loop
    setTimeout(() => {
      window.alert(`${title}\n\n${message || ''}`);
      if (buttons && buttons.length > 0) {
        // Fallback to calling the primary action button
        const primaryBtn = buttons.find(b => b.style !== 'cancel') || buttons[0];
        if (primaryBtn && primaryBtn.onPress) {
          primaryBtn.onPress();
        }
      }
    }, 100);
  }
};

export const StatusBar = () => null;

// Helper to convert React Native styles to standard inline CSS styles
function getWebStyles(rnStyle: any): any {
  if (!rnStyle) return {};
  if (Array.isArray(rnStyle)) {
    return rnStyle.reduce((acc, curr) => ({ ...acc, ...getWebStyles(curr) }), {});
  }
  
  // Convert basic React Native style keys to CSS
  const webStyle: any = { ...rnStyle };
  if (typeof webStyle.marginVertical === 'number') {
    webStyle.marginTop = webStyle.marginVertical;
    webStyle.marginBottom = webStyle.marginVertical;
    delete webStyle.marginVertical;
  }
  if (typeof webStyle.marginHorizontal === 'number') {
    webStyle.marginLeft = webStyle.marginHorizontal;
    webStyle.marginRight = webStyle.marginHorizontal;
    delete webStyle.marginHorizontal;
  }
  if (typeof webStyle.paddingVertical === 'number') {
    webStyle.paddingTop = webStyle.paddingVertical;
    webStyle.paddingBottom = webStyle.paddingVertical;
    delete webStyle.paddingVertical;
  }
  if (typeof webStyle.paddingHorizontal === 'number') {
    webStyle.paddingLeft = webStyle.paddingHorizontal;
    webStyle.paddingRight = webStyle.paddingHorizontal;
    delete webStyle.paddingHorizontal;
  }
  
  return webStyle;
}

export const Platform = {
  OS: 'web',
  select: (objs: any) => objs.web || objs.default || objs.android,
};
