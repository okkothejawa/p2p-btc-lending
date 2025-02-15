import { ConnectButton } from '@rainbow-me/rainbowkit';
import UnisatWallet from './UnisatWallet';
import Image from 'next/image';
import Link from 'next/link';

const Header = () => {
  return (
    <header className="flex w-full max-w-screen-2xl justify-between">
      <Link href="/" className="flex gap-2 items-end hover:opacity-80 transition-opacity">
        <Image src="/PlumFiLogo.svg" width={40} height={40} alt="PlumFi" />
        <h1 className="text-white text-3xl font-semibold pt-1">PlumFi</h1>
      </Link>
      <div className="flex gap-4 items-center">
        <ConnectButton />
        <UnisatWallet />
      </div>
    </header>
  );
};
export default Header;
