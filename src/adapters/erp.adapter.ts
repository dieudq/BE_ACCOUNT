import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

interface ERPWorklog {
  employeeId: string;
  employeeName: string;
  projectCode: string;
  projectName: string;
  loggedHours: number;
  year: number;
  month: number;
}

@Injectable()
export class ERPAdapter {
  private client: AxiosInstance;
  private erpUrl: string;
  private erpKey: string;

  constructor() {
    this.erpUrl = process.env.ERP_API_URL || 'http://localhost:8080/api';
    this.erpKey = process.env.ERP_API_KEY || 'demo-key';

    this.client = axios.create({
      baseURL: this.erpUrl,
      headers: {
        'X-API-Key': this.erpKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Fetch employee worklogs from ERP for specific month
   */
  async getEmployeeWorklogs(year: number, month: number): Promise<ERPWorklog[]> {
    try {
      console.log(`📡 Fetching worklogs from ERP: ${year}/${month}`);

      // Try ERP API
      const response = await this.client.get('/timesheets', {
        params: {
          year,
          month,
          status: 'approved',
        },
      });

      // Transform ERP format to internal format
      const worklogs = response.data.data || response.data;

      if (!Array.isArray(worklogs)) {
        console.warn('⚠️ ERP returned non-array data, skipping');
        return [];
      }

      return worklogs.map((log: any) => ({
        employeeId: log.employee_id || log.employeeId,
        employeeName: log.employee_name || log.employeeName,
        projectCode: log.project_code || log.projectCode,
        projectName: log.project_name || log.projectName,
        loggedHours: parseFloat(log.hours || log.loggedHours || '0'),
        year,
        month,
      }));
    } catch (error) {
      console.error('❌ ERP fetch failed:', error.message);
      return [];
    }
  }

  /**
   * Fetch all employees from ERP
   */
  async getEmployees(): Promise<
    Array<{
      id: string;
      name: string;
      email: string;
      department: string;
    }>
  > {
    try {
      const response = await this.client.get('/employees');
      const employees = response.data.data || response.data;

      if (!Array.isArray(employees)) return [];

      return employees.map((emp: any) => ({
        id: emp.employee_id || emp.id,
        name: emp.employee_name || emp.name,
        email: emp.email,
        department: emp.department,
      }));
    } catch (error) {
      console.error('❌ ERP employee fetch failed:', error.message);
      return [];
    }
  }

  /**
   * Fetch all projects from ERP
   */
  async getProjects(): Promise<
    Array<{
      id: string;
      code: string;
      name: string;
    }>
  > {
    try {
      const response = await this.client.get('/projects');
      const projects = response.data.data || response.data;

      if (!Array.isArray(projects)) return [];

      return projects.map((proj: any) => ({
        id: proj.project_id || proj.id,
        code: proj.code,
        name: proj.name,
      }));
    } catch (error) {
      console.error('❌ ERP project fetch failed:', error.message);
      return [];
    }
  }

  /**
   * Health check - verify ERP connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/health');
      return true;
    } catch {
      return false;
    }
  }
}
