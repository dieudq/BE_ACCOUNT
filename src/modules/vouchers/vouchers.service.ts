import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';

@Injectable()
export class VouchersService {
  constructor(private prisma: PrismaService) {}

  async create(createVoucherDto: CreateVoucherDto) {
    return this.prisma.voucher.create({
      data: createVoucherDto,
    });
  }

  async findAll() {
    return this.prisma.voucher.findMany({
      include: {
        user: true,
        project: true,
        botLogs: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.voucher.findUnique({
      where: { id },
      include: {
        user: true,
        project: true,
        phieuChi: true,
        botLogs: true,
      },
    });
  }

  async update(id: string, updateVoucherDto: UpdateVoucherDto) {
    return this.prisma.voucher.update({
      where: { id },
      data: updateVoucherDto,
      include: {
        user: true,
        project: true,
      },
    });
  }

  async remove(id: string) {
    return this.prisma.voucher.delete({
      where: { id },
    });
  }
}
