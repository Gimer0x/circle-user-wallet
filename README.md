# Circle Social Login – User Wallet Quickstart

A Next.js web app that lets users sign in with Google and create a user-controlled wallet using [Circle's Programmable Wallets](https://developers.circle.com/wallets/user-controlled/create-user-wallets-with-social-login).

## What it does

- Authenticates users with **Google OAuth**
- Creates a **user-owned wallet** and links it to your app
- Displays **wallet address**, **blockchain**, and **USDC balance**

## Prerequisites

- [Circle Developer Console](https://console.circle.com/) account
- Circle **API key** (Console → Keys → Create key → API key → Standard Key)
- [Google Cloud Console](https://console.cloud.google.com/) account
- **Node.js 18+**

## Setup

### 1. Configure Google OAuth (Google Cloud Console)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Enable **Google Auth Platform** and create an OAuth client:
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000` (or your app URL)
3. Copy the **Client ID** (Web).

### 2. Configure Circle Console

1. Log in to [Circle Developer Console](https://console.circle.com/).
2. Go to **Wallets → User Controlled → Configurator**.
3. Under **Authentication Methods → Social Logins**, select **Google** and paste your Google **Client ID (Web)**.
4. Copy your **App ID** from the Configurator.

### 3. Install dependencies

```bash
npm install
```

### 4. Environment variables

Create a `.env.local` file in the project root:

```env
CIRCLE_API_KEY=<YOUR_CIRCLE_API_KEY>
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<YOUR_GOOGLE_WEB_CLIENT_ID>
NEXT_PUBLIC_CIRCLE_APP_ID=<YOUR_CIRCLE_APP_ID>
```

- **CIRCLE_API_KEY** – Your Circle Developer API key
- **NEXT_PUBLIC_GOOGLE_CLIENT_ID** – Google OAuth Web Client ID from Step 1
- **NEXT_PUBLIC_CIRCLE_APP_ID** – Circle Wallet App ID from Step 2

Optional:

```env
NEXT_PUBLIC_CIRCLE_BASE_URL=https://api.circle.com
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
```

- **NEXT_PUBLIC_CONTRACT_ADDRESS** – Token contract address for the mint feature (must expose `mint(uint256,address)`). Omit if you are not using the mint UI.

## Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Complete the flow by clicking the buttons in order:

1. **Create device token** – Backend exchanges `deviceId` for SDK tokens used for Google auth.
2. **Login with Google** – Starts Google OAuth; Circle returns `userToken` and `encryptionKey`.
3. **Initialize user** – Backend initializes the user and returns a `challengeId` (or loads existing wallet).
4. **Create wallet** – SDK executes the challenge; user approves and the wallet is created.

The app then shows the wallet address, blockchain, and USDC balance.

## Fund the wallet (testing)

1. Copy the wallet address from the app.
2. Go to the [Circle Faucet](https://faucet.circle.com/).
3. Select **Arc Testnet**, paste the address, and send USDC.
4. Return to the app and complete the flow again with the same Google account to see the updated balance.

## Project structure

| Path | Description |
|------|-------------|
| `src/app/layout.js` | Root layout |
| `src/app/page.js` | Main UI and client logic (SDK init, device token, login, initialize, execute challenge) |
| `src/app/api/endpoints/route.js` | Backend route that proxies Circle API (`createDeviceToken`, `initializeUser`, `listWallets`, `getTokenBalance`) |

## Documentation

- [Create User Wallets with Social Login](https://developers.circle.com/wallets/user-controlled/create-user-wallets-with-social-login)
- [Circle Developer Console](https://console.circle.com/)
