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
  position: number;
  createdAt: string;
};

export type Flag = {
  id: string;
  userId: string;
  name: string;
  color: string;
  createdAt: string;
};

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
};
