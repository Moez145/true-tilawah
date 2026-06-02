const prisma = require("../models/prismaClient");
const { hashPassword, comparePassword } = require("../utils/hash.util");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../utils/jwt.util");

/**
 * Registers a new user and initialises their Progress record (1:1).
 */
const registerUser = async ({ fullName, email, password }) => {
  // Check duplicate email
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const err = new Error("Email is already registered.");
    err.statusCode = 409;
    throw err;
  }

  const passwordHash = await hashPassword(password);

  // Create user + seed a Progress row atomically
  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: { fullName, email, passwordHash },
    });

    await tx.progress.create({
      data: { userId: newUser.id },
    });

    return newUser;
  });

  const tokenPayload = { id: user.id, email: user.email };
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  return {
    user: { id: user.id, fullName: user.fullName, email: user.email },
    accessToken,
    refreshToken,
  };
};

/**
 * Authenticates an existing user and issues tokens.
 */
const loginUser = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const err = new Error("Invalid email or password.");
    err.statusCode = 401;
    throw err;
  }

  const isMatch = await comparePassword(password, user.passwordHash);
  if (!isMatch) {
    const err = new Error("Invalid email or password.");
    err.statusCode = 401;
    throw err;
  }

  const tokenPayload = { id: user.id, email: user.email };
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  return {
    user: { id: user.id, fullName: user.fullName, email: user.email },
    accessToken,
    refreshToken,
  };
};

/**
 * Issues a new access token from a valid refresh token.
 */
const refreshAccessToken = async (refreshToken) => {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    const err = new Error("Invalid or expired refresh token.");
    err.statusCode = 401;
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: { id: true, email: true },
  });

  if (!user) {
    const err = new Error("User not found.");
    err.statusCode = 401;
    throw err;
  }

  const accessToken = signAccessToken({ id: user.id, email: user.email });
  return { accessToken };
};

/**
 * Returns the authenticated user's profile (no passwordHash).
 */
const getProfile = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      avatarUrl: true,
      createdAt: true,
      progress: {
        select: {
          averageAccuracy: true,
          totalSessions: true,
          dailyStreak: true,
          totalTimeMin: true,
          lastPracticed: true,
        },
      },
    },
  });

  if (!user) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }

  return user;
};

module.exports = { registerUser, loginUser, refreshAccessToken, getProfile };
