// Auth.js setup. This file is frozen after task F3.
//
// Session strategy is JWT, not database sessions, because the test sign-in
// uses the Credentials provider, which Auth.js only supports with JWT.
// Users and linked accounts are still stored in the database through the
// adapter. There is no middleware: route protection is requireUser() in the
// (app) layout and in every server action and route handler.

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

import { authorizeDemo, refuseDemoLink } from "./demo-sign-in";
import { findOrCreateTestUser, isTestEmail, isTestSignInEnabled } from "./test-sign-in";

export const googleConfigured = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);
export const testSignInEnabled = isTestSignInEnabled(process.env);

const providers = [];

if (googleConfigured) providers.push(Google);

if (testSignInEnabled) {
  providers.push(
    Credentials({
      id: "test",
      name: "Test sign-in",
      credentials: { email: { label: "Email (name@test.local)" } },
      async authorize(credentials) {
        // Checked again here, at the moment of sign-in, not only when the provider list is built.
        if (!isTestSignInEnabled(process.env)) return null;
        const email = credentials?.email;
        if (!isTestEmail(email)) return null;
        const user = await findOrCreateTestUser(email);
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  );
}

// The demo sign-in (SPEC-demo.md) is on in production too. It has no fields and can
// only create a fresh demo copy, never reach the template, another copy or a real user.
providers.push(
  Credentials({
    id: "demo",
    name: "Demo",
    credentials: {},
    authorize: () => authorizeDemo(),
  }),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers,
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  events: {
    // Signing in with Google while in a demo copy would link the account to the copy.
    async linkAccount({ user, account }) {
      if (user.id) await refuseDemoLink(user.id, account);
    },
  },
  callbacks: {
    // Put the database user id in the token and the session.
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
