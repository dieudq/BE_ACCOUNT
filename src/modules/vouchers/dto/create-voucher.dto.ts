export class CreateVoucherDto {
  voucherNumber: string;
  userId?: string;
  amount?: number;
  reason?: string;
  projectId?: string;
  status?: string;
}
