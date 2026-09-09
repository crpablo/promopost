import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import PostgresAdapter from '@auth/pg-adapter';
import { getPool } from '@/lib/db/pool';
import { sendMagicLink } from '@/lib/email/sendMagicLink';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(getPool()),
  session: { strategy: 'database' },
  providers: [
    Nodemailer({
      server: 'smtp://unused.invalid', // never used: sendVerificationRequest is overridden below
      from: process.env.EMAIL_FROM ?? 'PromoPost <login@promopost.tobiestore.com.br>',
      async sendVerificationRequest({ identifier, url }) {
        await sendMagicLink({ to: identifier, url });
      },
    }),
  ],
});
