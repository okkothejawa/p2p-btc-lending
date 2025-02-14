'use client';
import React from 'react';
import { RainbowKitProvider, darkTheme, Theme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import '@rainbow-me/rainbowkit/styles.css';
import merge from 'lodash.merge';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Chain, getDefaultConfig } from '@rainbow-me/rainbowkit';

interface ProviderProps {
  children: React.ReactNode;
}
const citrea = {
  id: parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || ''),
  name: `Citrea Testnet`,
  iconUrl: '/Logo.svg',
  iconBackground: '#fff',
  nativeCurrency: { name: 'Citrea BTC', symbol: 'cBTC', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL || ''] },
  },
  blockExplorers: {
    default: {
      name: 'BlockScout',
      url: process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL || '',
    },
  },
} as const satisfies Chain;

const chains: readonly [Chain, ...Chain[]] = [citrea];

export const config = getDefaultConfig({
  appName: 'PlumFi',
  projectId: process.env.NEXT_PUBLIC_PROJECT_ID ?? '',
  chains,
  ssr: true,
});
export default function Providers({ children }: ProviderProps) {
  const [queryClient] = React.useState(() => new QueryClient());

  const myTheme = merge(darkTheme(), {
    colors: {
      accentColor: '#932877',
    },
  } as Theme);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={myTheme} locale="en">
          <div>{children}</div>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
