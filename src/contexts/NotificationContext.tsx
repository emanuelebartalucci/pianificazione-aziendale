import React, { createContext, useContext } from 'react';
import { useAuth } from './AuthContext';
import { useNotificationWatcher, type OperativeNotificationItem, type SectionBadgeCounts } from '../hooks/useNotificationWatcher';
import type { UserNotification } from '../utils/userNotificationService';

interface NotificationContextType {
  totalPendingCount: number;
  operativePendingCount: number;
  operativeNotifications: OperativeNotificationItem[];
  userNotifications: UserNotification[];
  unreadUserNotificationsCount: number;
  permissionState: NotificationPermission;
  handleEnableNotifications: () => Promise<void>;
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: (userEmail: string) => Promise<void>;
  sectionBadgeCounts: SectionBadgeCounts;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { 
    userEmail, 
    myAssociatedName, 
    isAdmin, 
    isHR, 
    isDev, 
    impersonatedEmail, 
    coordinatori, 
    isGestoreForniture,
    dipendenti,
    commesse
  } = useAuth();

  const watcher = useNotificationWatcher({
    userEmail,
    myAssociatedName,
    isAdmin,
    isHR,
    isDev,
    impersonatedEmail,
    coordinatori,
    isGestoreForniture,
    dipendenti,
    commesse
  });

  return (
    <NotificationContext.Provider value={watcher}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
