export type PugotiProfile = {
  username: string;
  displayName: string;
  nickname: string;
  avatarUrl: string;
  biography: string;
  location: string;
  role: "admin" | "user";
};

export type Folder = {
  id: string;
  userId: string;
  name: string;
  icon: string;
  color: string;
  position: number;
  createdAt: string;
};

export type Flag = {
  id: string;
  userId: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
};

export type RecurrenceType = "none" | "daily" | "weekly" | "custom";

export type Task = {
  id: string;
  userId: string;
  folderId: string;
  flagId: string | null;
  title: string;
  notes: string;
  dueAt: string | null;
  completed: boolean;
  important: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  recurrenceEndAt: string | null;
  recurrenceSeriesId: string | null;
  recurrenceParentId: string | null;
};


export type NoteFolder = {
  id: string;
  userId: string;
  name: string;
  icon: string;
  color: string;
  position: number;
  createdAt: string;
  locked: boolean;
};

export type VaultSettings = {
  vaultTimeoutMinutes: number;
};

export type Note = {
  id: string;
  userId: string;
  folderId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  pinnedAt: string | null;
};
