import { ConnectButton } from '@rainbow-me/rainbowkit';
import UnisatWallet from './UnisatWallet';
import Image from 'next/image';

const Header = () => {
  return (
    <header className="flex w-full max-w-screen-2xl justify-between">
      <div className="flex gap-2 items-end">
        <Image src="/PlumFiLogo.svg" width={40} height={40} alt="PlumFi" />
        <h1 className="text-white text-3xl font-semibold pt-1">PlumFi</h1>
      </div>
      <div className="flex gap-4 items-center">
        <ConnectButton />
        <UnisatWallet />
      </div>
    </header>
  );
};
export default Header;
