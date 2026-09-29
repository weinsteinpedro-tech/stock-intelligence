This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment Variables & Security

This project uses an encrypted vault system to protect sensitive API keys (`ALPHA_VANTAGE_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`, etc.) when exporting or sharing the code.

- **`.env.example`**: Public template listing required environment variables.
- **`.env.encrypted`**: Encrypted vault containing secrets with AES-256-GCM (safe to commit/share).
- **`.env.local`**: Local development file containing decrypted secrets (ignored by Git).

### Secrets Management Commands

- **Check status**:
  ```bash
  npm run secrets:status
  ```

- **Decrypt secrets (when cloning or importing the project)**:
  ```bash
  npm run secrets:decrypt
  # or pass password directly:
  npm run secrets:decrypt -- -p <YOUR_PASSWORD>
  ```

- **Re-encrypt secrets (after modifying `.env.local`)**:
  ```bash
  npm run secrets:encrypt
  # or specify a password:
  npm run secrets:encrypt -- -p <YOUR_PASSWORD>
  ```

- **Lock & prepare project for export / publishing**:
  ```bash
  npm run secrets:lock
  ```
  *(Verifies decryption works, deletes `.env.local` and cleans any leftover files so zero credentials are exposed)*.

---

## Getting Started

1. Restore your `.env.local` file:
   ```bash
   npm run secrets:decrypt
   ```
2. Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
