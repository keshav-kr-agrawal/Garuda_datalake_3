export interface NetInfoState {
  isConnected: boolean;
  isInternetReachable: boolean;
  type: string;
}

export type NetInfoChangeHandler = (state: NetInfoState) => void;

const listeners = new Set<NetInfoChangeHandler>();

const fireListeners = () => {
  const state: NetInfoState = {
    isConnected: navigator.onLine,
    isInternetReachable: navigator.onLine,
    type: 'wifi',
  };
  listeners.forEach(cb => cb(state));
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', fireListeners);
  window.addEventListener('offline', fireListeners);
}

export const fetch = async (): Promise<NetInfoState> => {
  const isOnline = typeof window !== 'undefined' ? window.navigator.onLine : true;
  return {
    isConnected: isOnline,
    isInternetReachable: isOnline,
    type: 'wifi',
  };
};

export const addEventListener = (callback: NetInfoChangeHandler) => {
  listeners.add(callback);
  
  // Fire initially
  callback({
    isConnected: navigator.onLine,
    isInternetReachable: navigator.onLine,
    type: 'wifi',
  });

  return () => {
    listeners.delete(callback);
  };
};

export default {
  addEventListener,
  fetch,
};
