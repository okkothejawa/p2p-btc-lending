import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

const invoices = [
  {
    invoice: 'INV001',
    paymentStatus: 'Paid',
    totalAmount: '$250.00',
    paymentMethod: 'Credit Card',
  },
  {
    invoice: 'INV002',
    paymentStatus: 'Pending',
    totalAmount: '$150.00',
    paymentMethod: 'PayPal',
  },
  {
    invoice: 'INV003',
    paymentStatus: 'Unpaid',
    totalAmount: '$350.00',
    paymentMethod: 'Bank Transfer',
  },
  {
    invoice: 'INV004',
    paymentStatus: 'Paid',
    totalAmount: '$450.00',
    paymentMethod: 'Credit Card',
  },
  {
    invoice: 'INV005',
    paymentStatus: 'Paid',
    totalAmount: '$550.00',
    paymentMethod: 'PayPal',
  },
  {
    invoice: 'INV006',
    paymentStatus: 'Pending',
    totalAmount: '$200.00',
    paymentMethod: 'Bank Transfer',
  },
  {
    invoice: 'INV007',
    paymentStatus: 'Unpaid',
    totalAmount: '$300.00',
    paymentMethod: 'Credit Card',
  },
];

export default function Home() {
  return (
    <main className="flex flex-col w-full h-full pt-20">
      <div className="flex justify-end mb-4 px-4 gap-4">
        <Link href="/lender-fill">
          <Button 
            variant="outline"
            className="font-bold px-6 py-2"
          >
            Fill Borrow Request
          </Button>
        </Link>
        <Link href="/borrow-request">
          <Button 
            variant="default"
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold px-6 py-2"
          >
            Create Borrow Request
          </Button>
        </Link>
      </div>
      <Card className="p-10 border rounded-xl w-full bg-transparent text-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-white font-semibold">
                Barrow Amount
              </TableHead>
              <TableHead className="text-white font-semibold">
                Interest Rate
              </TableHead>
              <TableHead className="text-white font-semibold">Method</TableHead>
              <TableHead className="text-white font-semibold text-right">
                Amount
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.invoice}>
                <TableCell className="font-medium">{invoice.invoice}</TableCell>
                <TableCell>{invoice.paymentStatus}</TableCell>
                <TableCell>{invoice.paymentMethod}</TableCell>
                <TableCell className="text-right">
                  {invoice.totalAmount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </main>
  );
}