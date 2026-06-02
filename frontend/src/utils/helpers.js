import { Share, Platform } from 'react-native';

export const shareContent = async (title, text) => {
  try {
    await Share.share({ title, message: `${title}\n\n${text}` });
  } catch (e) {}
};

export const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
};

export const formatMinutes = (mins) => {
  if (!mins) return '0m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

export const getShadow = (elevation = 4) =>
  Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: elevation / 2 },
      shadowOpacity: 0.10,
      shadowRadius: elevation,
    },
    android: { elevation },
  });
