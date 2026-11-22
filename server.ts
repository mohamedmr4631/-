import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';

type UserRole = 'admin' | 'user';

interface StoredUser {
  id: string;
  username: string;
  role: UserRole;
  roleTitle: string;
  employeeId: string;
  passwordHash: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  roleTitle: string;
  employeeId: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

interface SessionPayload {
  sub: string;
  username: string;
  role: UserRole;
  exp: number;
}

interface AuthenticatedRequest extends Request {
  authUser?: StoredUser;
}

const PORT = 3000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

const DATA_DIR = path.resolve(process.cwd(), '.data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Precomputed salted scrypt hashes for initial accounts requested by the user
const INITIAL_USERS: StoredUser[] = [
  {
    id: 'usr_admin_mohamed',
    username: 'محمد رجب',
    role: 'admin',
    roleTitle: 'مدير النظام',
    employeeId: 'emp_mohamed_ragab',
    passwordHash:
      'fc41d0ef352905693a71e5ccf6a4dbe1:49f0bde8e733b13a5c098a646a20a630a172899755fe5d84adfcd6681b4ca45b824c7ccd8e0f957ba530a02a3f48b1dbf79032ad43ea94d984e5a0646e7cc3ad',
    isActive: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'usr_emp_azzam',
    username: 'عزام',
    role: 'user',
    roleTitle: 'موظف',
    employeeId: 'emp_azzam',
    passwordHash:
      '7b9b693d4fbd83047f50ca10a5c61276:34259a26738ca28979de4a443a085104f757c8ec62da8b462dc79d5bddc007de65386c4d158cc46a6c0cdcd2ac09ccb2fecae70343273688de52b352e9d0286a',
    isActive: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, derivedBuf);
  } catch {
    return false;
  }
}

function normalizeUsername(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function ensureUsersStore(): StoredUser[] {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(INITIAL_USERS, null, 2), 'utf8');
    return [...INITIAL_USERS];
  }
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      fs.writeFileSync(USERS_FILE, JSON.stringify(INITIAL_USERS, null, 2), 'utf8');
      return [...INITIAL_USERS];
    }
    return parsed as StoredUser[];
  } catch {
    fs.writeFileSync(USERS_FILE, JSON.stringify(INITIAL_USERS, null, 2), 'utf8');
    return [...INITIAL_USERS];
  }
}

function writeUsersStore(users: StoredUser[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(users, null, 2), 'utf8');
  fs.renameSync(tmpFile, USERS_FILE);
}

function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    roleTitle: user.roleTitle,
    employeeId: user.employeeId,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function signToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as SessionPayload;
    if (!parsed.sub || !parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'يرجى تسجيل الدخول للمتابعة.' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.' });
    return;
  }

  const users = ensureUsersStore();
  const found = users.find((u) => u.id === payload.sub);
  if (!found || !found.isActive) {
    res.status(401).json({ error: 'الحساب غير نشط أو غير موجود.' });
    return;
  }

  req.authUser = found;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser || req.authUser.role !== 'admin') {
    res.status(403).json({ error: 'هذه الصلاحية متاحة للمدير فقط.' });
    return;
  }
  next();
}

async function startServer() {
  ensureUsersStore();
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Login endpoint
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
      res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
      return;
    }

    const username = normalizeUsername(body.username);
    const password = body.password;
    if (username.length < 2 || username.length > 60 || password.length < 1 || password.length > 100) {
      res.status(400).json({ error: 'بيانات الدخول غير صالحة.' });
      return;
    }

    const users = ensureUsersStore();
    const matched = users.find(
      (u) => normalizeUsername(u.username).toLowerCase() === username.toLowerCase()
    );

    if (!matched || !verifyPassword(password, matched.passwordHash)) {
      res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
      return;
    }

    if (!matched.isActive) {
      res.status(403).json({ error: 'تم تعطيل هذا الحساب من قبل المدير.' });
      return;
    }

    const token = signToken({
      sub: matched.id,
      username: matched.username,
      role: matched.role,
      exp: Date.now() + SESSION_TTL_MS,
    });

    res.json({
      token,
      user: toPublicUser(matched),
    });
  });

  // Current session info
  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: toPublicUser(req.authUser!) });
  });

  // Admin: list all user accounts
  app.get('/api/users', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const users = ensureUsersStore();
    res.json({ users: users.map(toPublicUser) });
  });

  // Admin: create new user account
  app.post('/api/users', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (
      !body ||
      typeof body.username !== 'string' ||
      typeof body.password !== 'string' ||
      (body.role !== 'admin' && body.role !== 'user')
    ) {
      res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور والصلاحية بشكل صحيح.' });
      return;
    }

    const username = normalizeUsername(body.username);
    const password = body.password;
    const role: UserRole = body.role;
    const roleTitle =
      typeof body.roleTitle === 'string' && body.roleTitle.trim().length > 0
        ? body.roleTitle.trim().slice(0, 60)
        : role === 'admin'
          ? 'مدير'
          : 'موظف';

    if (username.length < 2 || username.length > 60) {
      res.status(400).json({ error: 'اسم المستخدم يجب أن يكون بين حرفين و 60 حرفاً.' });
      return;
    }
    if (password.length < 4 || password.length > 100) {
      res.status(400).json({ error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل.' });
      return;
    }

    const users = ensureUsersStore();
    const exists = users.some(
      (u) => normalizeUsername(u.username).toLowerCase() === username.toLowerCase()
    );
    if (exists) {
      res.status(409).json({ error: 'اسم المستخدم مسجل مسبقاً.' });
      return;
    }

    const now = Date.now();
    const id = `usr_${crypto.randomBytes(6).toString('hex')}`;
    const employeeId =
      typeof body.employeeId === 'string' && /^[a-zA-Z0-9_-]{3,128}$/.test(body.employeeId)
        ? body.employeeId
        : `emp_${crypto.randomBytes(6).toString('hex')}`;

    const newUser: StoredUser = {
      id,
      username,
      role,
      roleTitle,
      employeeId,
      passwordHash: hashPassword(password),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    users.push(newUser);
    writeUsersStore(users);
    res.status(201).json({ user: toPublicUser(newUser) });
  });

  // Admin: update user password, role, roleTitle, or active state
  app.patch('/api/users/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.params.id;
    const body = req.body as Record<string, unknown> | undefined;
    if (!body) {
      res.status(400).json({ error: 'لا توجد بيانات للتحديث.' });
      return;
    }

    const users = ensureUsersStore();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) {
      res.status(404).json({ error: 'المستخدم غير موجود.' });
      return;
    }

    const target = { ...users[idx] };

    if (typeof body.password === 'string' && body.password.length > 0) {
      if (body.password.length < 4 || body.password.length > 100) {
        res.status(400).json({ error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل.' });
        return;
      }
      target.passwordHash = hashPassword(body.password);
    }

    if (body.role === 'admin' || body.role === 'user') {
      if (target.id === req.authUser?.id && body.role !== 'admin') {
        res.status(400).json({ error: 'لا يمكنك سحب صلاحية الإدارة من حسابك الحالي.' });
        return;
      }
      target.role = body.role;
    }

    if (typeof body.roleTitle === 'string') {
      target.roleTitle = body.roleTitle.trim().slice(0, 60);
    }

    if (typeof body.isActive === 'boolean') {
      if (target.id === req.authUser?.id && !body.isActive) {
        res.status(400).json({ error: 'لا يمكنك تعطيل حسابك الحالي.' });
        return;
      }
      target.isActive = body.isActive;
    }

    target.updatedAt = Date.now();
    users[idx] = target;
    writeUsersStore(users);
    res.json({ user: toPublicUser(target) });
  });

  // Admin: delete user account
  app.delete('/api/users/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.params.id;
    if (userId === req.authUser?.id) {
      res.status(400).json({ error: 'لا يمكنك حذف حسابك المسجل حالياً.' });
      return;
    }

    const users = ensureUsersStore();
    const nextUsers = users.filter((u) => u.id !== userId);
    if (nextUsers.length === users.length) {
      res.status(404).json({ error: 'المستخدم غير موجود.' });
      return;
    }

    writeUsersStore(nextUsers);
    res.json({ ok: true });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
