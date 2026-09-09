import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import PostgresAdapter from '@auth/pg-adapter';
import { getPool } from '@/lib/db/pool';
import { sendMagicLink } from '@/lib/email/sendMagicLink';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(getPool()),
  session: { strategy: 'database' },
  // @auth/core computes trustHost from
  // `AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? CF_PAGES ?? (NODE_ENV !== "production")`.
  // AUTH_URL (see .env.example) already satisfies that on its own in production,
  // but the Dockerfile hardcodes NODE_ENV=production and none of the other vars
  // exist on the VPS, so this is set explicitly too as defense-in-depth against
  // ever running without AUTH_URL configured (which would otherwise make every
  // auth()/signIn() call fail with UntrustedHost).
  trustHost: true,
  // Sem isso, uma falha no envio do magic link (ex: Resend fora do ar) faz o
  // signIn() redirecionar pro /api/auth/error embutido do Auth.js, que não
  // tem rota própria configurada aqui e retorna um 500 genérico do Next em
  // vez de um erro claro pro usuário. Redirecionando pro próprio /login, o
  // erro chega como `?error=...` na query string e a página mostra uma
  // mensagem amigável (ver src/app/login/page.tsx).
  pages: { error: '/login' },
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
