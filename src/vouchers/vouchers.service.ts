import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VouchersService {
  constructor(private prisma: PrismaService) {}

  async getAll() {
    return this.prisma.voucher.findMany({
      include: { user: true, project: true },
    });
  }

  async getById(id: string) {
    return this.prisma.voucher.findUnique({
      where: { id },
      include: { user: true, project: true },
    });
  }

  async create(data: any) {
    return this.prisma.voucher.create({
      data,
      include: { user: true, project: true },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.voucher.update({
      where: { id },
      data,
      include: { user: true, project: true },
    });
  }

  async delete(id: string) {
    return this.prisma.voucher.delete({
      where: { id },
    });
  }
}
