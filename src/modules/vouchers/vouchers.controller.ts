import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';

@Controller('api/vouchers')
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  @Post()
  async create(@Body() createVoucherDto: CreateVoucherDto) {
    return this.vouchersService.create(createVoucherDto);
  }

  @Get()
  async findAll() {
    return this.vouchersService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.vouchersService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateVoucherDto: UpdateVoucherDto,
  ) {
    return this.vouchersService.update(id, updateVoucherDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.vouchersService.remove(id);
    return { success: true };
  }
}
