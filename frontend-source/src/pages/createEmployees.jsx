import { useEffect, useRef, useState } from "react";
import {
  CloudUpload,
  Download,
  FilePlus2,
  FileUp,
  LayoutDashboard,
  LoaderCircle,
  Redo2,
  Save,
  Undo2,
  Users,
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "@/components/ui/toast";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useSession } from "../auth-client";
import { apiRequest } from "../api-client";
import { columnName, parseCsv } from "../lib/csv";

const STORAGE_KEY = "payroll_mock_employees_workbook";
const SELECTED_COMPANY_KEY = "payroll_selected_company_id";
const WORKBOOK_NAME = "Employees";
const EMPLOYEE_BATCH_SIZE = 1000;
const MAX_EMPLOYEE_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_DIRECT_IMPORT_ROWS = 100000;
const MAX_DIRECT_IMPORT_BYTES = 50 * 1024 * 1024;
const EMPLOYEE_HEADERS = [
  "Full Name",
  "Email",
  "Department",
  "Position",
  "Employment Type",
  "Start Date",
  "Status",
  "Middle Name",
  "Birthdate",
  "Phone",
  "Address",
  "SSS Number",
  "Pag-IBIG ID",
  "PhilHealth Number",
  "Tax ID Number",
  "Base Salary (PHP)",
  "Daily Rate (PHP)",
  "Hourly Rate (PHP)",
  "Employee ID",
];

const FIELD_HEADERS = {
  fullName: ["fullname", "name", "employeename"],
  firstName: ["firstname", "givenname"],
  lastName: ["lastname", "surname", "familyname"],
  email: ["email", "emailaddress"],
  department: ["department", "team"],
  position: ["position", "jobtitle", "title"],
  employmentType: ["employmenttype", "type"],
  dateHired: ["datehired", "starthiredate", "startdate", "hiredate", "dateofhire"],
  employmentStatus: ["status", "employeestatus"],
  middleName: ["middlename"],
  extension: ["extension", "extname", "suffix"],
  birthdate: ["birthdate", "dateofbirth", "dob"],
  gender: ["gender", "sex"],
  civilStatus: ["civilstatus", "maritalstatus"],
  phone: ["phone", "phonenumber", "mobile"],
  address: ["address", "homeaddress"],
  socialSecurityNumber: ["socialsecuritynumber", "sssnumber", "sss"],
  pagIbigID: ["pagibig", "pagibigid", "pagibignumber"],
  philhealth: ["philhealth", "philhealthnumber"],
  taxIdNumber: ["taxidnumber", "taxid", "tin"],
  baseSalary: ["basesalaryphp", "basesalary", "salary"],
  dailyRate: ["dailyratephp", "dailyrate"],
  hourlyRate: ["hourlyratephp", "hourlyrate"],
  backendId: ["employeeid", "payrollid", "backendid", "serverid"],
};

function normalizeHeader(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getFieldValue(values, headers, field) {
  const aliases = FIELD_HEADERS[field];
  const index = headers.findIndex((header) =>
    aliases.includes(normalizeHeader(header)),
  );
  return index < 0 ? "" : (values[index] ?? "");
}

function initializeEmployeeSheet(sheet) {
  sheet.getRange("A1:S1").setValues([EMPLOYEE_HEADERS]);
  sheet
    .getRange("A1:S1")
    .setBackgroundColor("#1f2937")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setWrap(true);
  sheet.setRowHeight(0, 40);
  [
    200, 240, 150, 190, 145, 120, 110, 130, 120, 140, 220, 150, 140, 150,
    150, 145, 140, 150, 180,
  ].forEach((width, index) => sheet.setColumnWidth(index, width));
  sheet.hideColumns(18, 1);
}

function isDefaultEmployeeRoster(rows) {
  return (
    rows.length === 51 &&
    normalizeHeader(rows[0]?.[0]) === "fullname" &&
    normalizeHeader(rows[0]?.[1]) === "email" &&
    rows[1]?.[0] === "Clarissa Santos" &&
    rows[1]?.[1] === "clarissa.santos@example.com" &&
    rows[2]?.[0] === "Marco Bautista" &&
    rows[2]?.[1] === "marco.bautista@example.com"
  );
}

const COLUMN = {
  fullName: 0,
  email: 1,
  department: 2,
  position: 3,
  employmentType: 4,
  dateHired: 5,
  employmentStatus: 6,
  middleName: 7,
  birthdate: 8,
  phone: 9,
  address: 10,
  socialSecurityNumber: 11,
  pagIbigID: 12,
  philhealth: 13,
  taxIdNumber: 14,
  baseSalary: 15,
  dailyRate: 16,
  hourlyRate: 17,
  backendId: 18,
};

const navigationItems = [
  { label: "Dashboard", href: "/dashboard", Icon: LayoutDashboard },
  { label: "Employees", href: "/createEmployees", Icon: Users },
];

function replaceSheetWithRows(sheet, parsedRows) {
  const headers = parsedRows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) {
    throw new Error("Every CSV column must have a header.");
  }
  if (parsedRows.length > 1000) {
    throw new Error("The spreadsheet supports up to 1,000 CSV rows.");
  }
  if (headers.length > 19) {
    throw new Error(
      "Spreadsheet upload supports up to 19 columns so employee IDs can be tracked in the sheet.",
    );
  }
  if (parsedRows.some((row) => row.length > headers.length)) {
    throw new Error(
      "A CSV row has more cells than the header. Check commas and quoted fields.",
    );
  }
  if (new Set(headers.map(normalizeHeader)).size !== headers.length) {
    throw new Error("CSV column headers must be unique.");
  }

  const employeeIdColumn = headers.findIndex((header) =>
    FIELD_HEADERS.backendId.includes(normalizeHeader(header)),
  );
  if (employeeIdColumn < 0) {
    headers.push("Employee ID");
  } else {
    headers[employeeIdColumn] = "Employee ID";
  }
  const width = headers.length;
  const rows = parsedRows.map((row) =>
    Array.from({ length: width }, (_, index) => {
      const value = row[index] ?? "";
      return value.trimStart().startsWith("=") ? `'${value}` : value;
    }),
  );

  sheet.getRange("A1:T1000").clearContent();
  sheet
    .getRange(`A1:${columnName(width - 1)}${rows.length}`)
    .setValues(rows);
  sheet
    .getRange(`A1:${columnName(width - 1)}1`)
    .setBackgroundColor("#1f2937")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setWrap(true);
  sheet.hideColumns(employeeIdColumn < 0 ? width - 1 : employeeIdColumn, 1);
  if (rows.length > 1) {
    sheet
      .getRange(`A2:${columnName(width - 1)}${rows.length}`)
      .setWrap(true)
      .setVerticalAlignment("top");
  }
  sheet.setRowHeight(0, 40);
  headers.forEach((header, columnIndex) => {
    const longestCell = rows.reduce(
      (longest, row) =>
        Math.max(
          longest,
          ...String(row[columnIndex] ?? "")
            .split(/\r?\n/)
            .map((line) => line.length),
        ),
      header.length,
    );
    sheet.setColumnWidth(
      columnIndex,
      Math.min(360, Math.max(130, longestCell * 8 + 32)),
    );
  });
  rows.slice(1).forEach((_, rowIndex) => sheet.autoFitRow(rowIndex + 1));
  return rows.length - 1;
}

export default function CreateEmployees() {
  const containerRef = useRef(null);
  const csvInputRef = useRef(null);
  const payrollImportInputRef = useRef(null);
  const workbookRef = useRef(null);
  const univerApiRef = useRef(null);
  const backendSaveRef = useRef(false);
  const { data: session } = useSession();
  const [status, setStatus] = useState("Loading spreadsheet…");
  const [error, setError] = useState("");
  const [companies, setCompanies] = useState([]);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);
  const [selectedCompanyId, setSelectedCompanyId] = useState(
    () => window.localStorage.getItem(SELECTED_COMPANY_KEY) || "",
  );
  const [companyError, setCompanyError] = useState("");
  const [serverError, setServerError] = useState("");
  const [isSavingToBackend, setIsSavingToBackend] = useState(false);

  const uploadSpreadsheetFile = async (file) => {
    try {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("Spreadsheet files must be 5 MB or smaller.");
      }
      const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
      let parsedRows;
      if (isCsv) {
        parsedRows = parseCsv(await file.text());
      } else {
        const XLSX = await import("xlsx");
        const excelWorkbook = XLSX.read(await file.arrayBuffer(), {
          cellDates: true,
        });
        const firstSheetName = excelWorkbook.SheetNames[0];
        const firstSheet = firstSheetName
          ? excelWorkbook.Sheets[firstSheetName]
          : undefined;
        if (!firstSheet) {
          throw new Error("The Excel file does not contain a readable worksheet.");
        }
        parsedRows = XLSX.utils.sheet_to_json(firstSheet, {
          header: 1,
          defval: "",
          raw: false,
          dateNF: "yyyy-mm-dd",
        });
      }
      const sheet = workbookRef.current?.getActiveSheet();
      if (!sheet) throw new Error("The spreadsheet is not ready yet.");

      const rowCount = replaceSheetWithRows(sheet, parsedRows);
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(workbookRef.current.save()),
      );
      setStatus(
        `Loaded ${rowCount} rows from ${file.name} into the editable spreadsheet`,
      );
      setError("");
      setServerError("");
    } catch (uploadError) {
      setServerError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not read the spreadsheet file.",
      );
    } finally {
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  const importEmployeeFileToPayroll = async (file) => {
    if (!file) return;
    if (!selectedCompanyId) {
      setServerError("Create or select a company before importing employees.");
      return;
    }

    setIsSavingToBackend(true);
    backendSaveRef.current = true;
    setServerError("");
    const uploadToastId = toast.add({
      type: "loading",
      title: "Preparing employee import",
      description: `Reading ${file.name}…`,
      timeout: 0,
    });
    let importedCount = 0;

    try {
      if (file.size > MAX_DIRECT_IMPORT_BYTES) {
        throw new Error("Employee import files must be 50 MB or smaller.");
      }

      const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
      let parsedRows;
      if (isCsv) {
        parsedRows = parseCsv(await file.text());
      } else {
        const XLSX = await import("xlsx");
        const excelWorkbook = XLSX.read(await file.arrayBuffer(), {
          cellDates: true,
        });
        const firstSheetName = excelWorkbook.SheetNames[0];
        const firstSheet = firstSheetName
          ? excelWorkbook.Sheets[firstSheetName]
          : undefined;
        if (!firstSheet) {
          throw new Error("The Excel file does not contain a readable worksheet.");
        }
        parsedRows = XLSX.utils.sheet_to_json(firstSheet, {
          header: 1,
          defval: "",
          raw: false,
          dateNF: "yyyy-mm-dd",
        });
      }

      const headers = parsedRows[0]?.map((header) => String(header).trim());
      if (!headers?.length || headers.some((header) => !header)) {
        throw new Error("Every employee column must have a header.");
      }
      if (new Set(headers.map(normalizeHeader)).size !== headers.length) {
        throw new Error("Employee column headers must be unique.");
      }
      const records = parsedRows.slice(1);
      if (records.length > MAX_DIRECT_IMPORT_ROWS) {
        throw new Error("Employee imports support up to 100,000 rows.");
      }
      if (records.some((row) => row.length > headers.length)) {
        throw new Error("A row has more cells than the header. Check the source file.");
      }

      const readyEmployees = [];
      let incompleteRows = 0;
      for (const [index, values] of records.entries()) {
        const fullName = String(getFieldValue(values, headers, "fullName") ?? "")
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        const firstname =
          String(getFieldValue(values, headers, "firstName") ?? "").trim() ||
          fullName[0] ||
          "";
        const lastname =
          String(getFieldValue(values, headers, "lastName") ?? "").trim() ||
          (fullName.length > 1 ? fullName.at(-1) : "");
        const amounts = [
          getFieldValue(values, headers, "baseSalary"),
          getFieldValue(values, headers, "dailyRate"),
          getFieldValue(values, headers, "hourlyRate"),
        ].map((value) => Number(String(value).replace(/[,\s$₱]/g, "")));
        const requiredValues = [
          firstname,
          lastname,
          String(getFieldValue(values, headers, "dateHired") ?? "").trim(),
          String(getFieldValue(values, headers, "socialSecurityNumber") ?? "").trim(),
          String(getFieldValue(values, headers, "pagIbigID") ?? "").trim(),
          String(getFieldValue(values, headers, "philhealth") ?? "").trim(),
          String(getFieldValue(values, headers, "taxIdNumber") ?? "").trim(),
        ];
        if (
          requiredValues.some((value) => !value) ||
          amounts.some((amount) => !Number.isFinite(amount) || amount <= 0)
        ) {
          incompleteRows += 1;
          continue;
        }

        const type = String(getFieldValue(values, headers, "employmentType") ?? "")
          .toLowerCase();
        const employmentStatus = String(
          getFieldValue(values, headers, "employmentStatus") || "ACTIVE",
        )
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/g, "_");
        const optionalText = (field) =>
          String(getFieldValue(values, headers, field) ?? "").trim() || null;

        readyEmployees.push({
          firstname,
          middlename:
            optionalText("middleName") ||
            (fullName.length > 2 ? fullName.slice(1, -1).join(" ") : null),
          lastname,
          extname: optionalText("extension"),
          birthdate: optionalText("birthdate"),
          gender: optionalText("gender"),
          civilStatus: optionalText("civilStatus") || "SINGLE",
          email: optionalText("email"),
          phone: optionalText("phone"),
          address: optionalText("address"),
          employmentType: type.includes("contract")
            ? "CONTRACT"
            : type.includes("part")
              ? "PART_TIME"
              : "REGULAR",
          employmentStatus,
          dateHired: requiredValues[2],
          department: optionalText("department"),
          position: optionalText("position"),
          socialSecurityNumber: requiredValues[3],
          pagIbigID: requiredValues[4],
          philhealth: requiredValues[5],
          taxIdNumber: requiredValues[6],
          baseSalaryCents: Math.round(amounts[0] * 100),
          dailyRateCents: Math.round(amounts[1] * 100),
          hourlyRateCents: Math.round(amounts[2] * 100),
        });

        if (index % 5000 === 0) {
          toast.update(uploadToastId, {
            description: `Preparing employee ${index + 1} of ${records.length}…`,
          });
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }

      if (!readyEmployees.length) {
        throw new Error(
          `No complete employees to import. ${incompleteRows} row${incompleteRows === 1 ? "" : "s"} need required payroll details.`,
        );
      }

      let start = 0;
      while (start < readyEmployees.length) {
        const batch = [];
        let batchBytes = 128;
        while (
          start + batch.length < readyEmployees.length &&
          batch.length < EMPLOYEE_BATCH_SIZE
        ) {
          const employee = readyEmployees[start + batch.length];
          const employeeBytes = new TextEncoder().encode(
            JSON.stringify(employee),
          ).byteLength + 1;
          if (employeeBytes > MAX_EMPLOYEE_BATCH_BYTES) {
            throw new Error(
              `Employee record ${start + batch.length + 1} is too large to upload.`,
            );
          }
          if (
            batch.length > 0 &&
            batchBytes + employeeBytes > MAX_EMPLOYEE_BATCH_BYTES
          ) {
            break;
          }
          batch.push(employee);
          batchBytes += employeeBytes;
        }

        const result = await apiRequest("/api/employees/batch", {
          method: "POST",
          body: { companyId: selectedCompanyId, employees: batch },
        });
        if (
          !Array.isArray(result?.data) ||
          result.data.length !== batch.length ||
          result.data.some((employee) => typeof employee?.id !== "string")
        ) {
          throw new Error(
            `Import stopped after ${importedCount} employees. The server did not confirm this batch; check the employee list before retrying.`,
          );
        }

        importedCount += batch.length;
        start += batch.length;
        const progressText = `Added ${importedCount} of ${readyEmployees.length} employees${incompleteRows ? `; skipped ${incompleteRows} incomplete rows` : ""}.`;
        setStatus(progressText);
        toast.update(uploadToastId, { description: progressText });
      }

      setStatus(
        `${importedCount} employees added${incompleteRows ? `; ${incompleteRows} incomplete rows skipped` : ""}`,
      );
      toast.update(uploadToastId, {
        type: incompleteRows ? "warning" : "success",
        title: incompleteRows ? "Employee import completed with skipped rows" : "Employee import completed",
        description: `${importedCount} employees added${incompleteRows ? `; ${incompleteRows} incomplete rows skipped` : ""}.`,
      });
    } catch (importError) {
      const message =
        importError instanceof Error
          ? importError.message
          : "Could not import employee records.";
      const progressMessage = importedCount
        ? `${importedCount} employees were added before the import stopped. ${message}`
        : message;
      setServerError(progressMessage);
      setStatus("Employee import incomplete");
      toast.update(uploadToastId, {
        type: "error",
        title: "Employee import incomplete",
        description: progressMessage,
      });
    } finally {
      backendSaveRef.current = false;
      setIsSavingToBackend(false);
      if (payrollImportInputRef.current) payrollImportInputRef.current.value = "";
    }
  };

  useEffect(() => {
    const adminId = session?.user?.id;
    if (!adminId) return undefined;

    let active = true;
    apiRequest(`/api/companies/admin/${encodeURIComponent(adminId)}`)
      .then((result) => {
        const ownedCompanies = Array.isArray(result?.data) ? result.data : [];
        if (!active) return;
        setCompanies(ownedCompanies);
        setIsLoadingCompanies(false);
        const savedCompanyId = window.localStorage.getItem(
          SELECTED_COMPANY_KEY,
        );
        const initialCompanyId = ownedCompanies.some(
          (company) => company.id === savedCompanyId,
        )
          ? savedCompanyId
          : (ownedCompanies[0]?.id ?? "");
        setSelectedCompanyId(initialCompanyId);
        if (initialCompanyId) {
          window.localStorage.setItem(SELECTED_COMPANY_KEY, initialCompanyId);
        }
      })
      .catch((companyLoadError) => {
        if (active) {
          setIsLoadingCompanies(false);
          setCompanyError(
            companyLoadError instanceof Error
              ? companyLoadError.message
              : "Could not load your companies.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    let active = true;
    let saveTimer;
    let initializationTimer;
    let univer;
    let saveSubscription;

    initializationTimer = window.setTimeout(async () => {
      try {
        if (!active) return;
        if (!containerRef.current) {
          throw new Error("The employee spreadsheet container is unavailable.");
        }

        const savedSnapshot = window.localStorage.getItem(STORAGE_KEY);
        const workbookSnapshot = savedSnapshot
          ? JSON.parse(savedSnapshot)
          : { name: WORKBOOK_NAME };
        const [
          { LocaleType, createUniver },
          { UniverSheetsCorePreset },
          sheetsCoreLocaleModule,
        ] = await Promise.all([
          import("@univerjs/presets"),
          import("@univerjs/preset-sheets-core"),
          import("@univerjs/preset-sheets-core/locales/en-US"),
          import("@univerjs/design/lib/index.css"),
          import("@univerjs/preset-sheets-core/lib/index.css"),
        ]);
        if (!active) return;
        const created = createUniver({
          locale: LocaleType.EN_US,
          locales: { [LocaleType.EN_US]: sheetsCoreLocaleModule.default },
          presets: [
            UniverSheetsCorePreset({
              container: containerRef.current,
              header: true,
              toolbar: true,
              formulaBar: true,
              footer: true,
            }),
          ],
        });
        univer = created.univer;

        const workbook = created.univerAPI.createWorkbook(workbookSnapshot);
        workbookRef.current = workbook;
        univerApiRef.current = created.univerAPI;
        const sheet = workbook.getActiveSheet();
        const headers = sheet.getRange("A1:T1").getValues()[0] ?? [];
        const employeeIdColumn = headers.findIndex((header) =>
          FIELD_HEADERS.backendId.includes(normalizeHeader(header)),
        );
        if (employeeIdColumn >= 0) {
          sheet.hideColumns(employeeIdColumn, 1);
        }
        if (
          employeeIdColumn >= 0 &&
          normalizeHeader(headers[employeeIdColumn]) !== "employeeid"
        ) {
          sheet
            .getRange(`${columnName(employeeIdColumn)}1`)
            .setValue("Employee ID");
        }
        if (!savedSnapshot) {
          initializeEmployeeSheet(sheet);
        } else if (isDefaultEmployeeRoster(sheet.getDataRange().getValues())) {
          sheet.getRange("A1:T1000").clearContent();
          initializeEmployeeSheet(sheet);
        }

        const saveWorkbook = () => {
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(workbook.save()),
          );
          if (active && !backendSaveRef.current) {
            setStatus("Draft auto-saved");
          }
        };

        saveSubscription = created.univerAPI.addEvent(
          created.univerAPI.Event.CommandExecuted,
          () => {
            window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(() => {
              try {
                saveWorkbook();
              } catch (saveError) {
                if (active) {
                  setError(
                    saveError instanceof Error
                      ? saveError.message
                      : "Could not save spreadsheet changes.",
                  );
                }
              }
            }, 300);
          },
        );
        saveWorkbook();
      } catch (initializationError) {
        if (active) {
          setError(
            initializationError instanceof Error
              ? initializationError.message
              : "Could not initialize the employee spreadsheet.",
          );
        }
      }
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(initializationTimer);
      window.clearTimeout(saveTimer);
      saveSubscription?.dispose();
      univer?.dispose();
      workbookRef.current = null;
      univerApiRef.current = null;
    };
  }, []);

  const saveWorkbook = () => {
    try {
      const workbook = workbookRef.current;
      if (!workbook) return;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workbook.save()));
      setStatus("Draft auto-saved");
      setError("");
      toast.add({
        type: "success",
        title: "Spreadsheet saved",
        description: "Your changes are saved on this computer.",
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save spreadsheet changes.",
      );
    }
  };

  const createNewEmployeeRecord = () => {
    const workbook = workbookRef.current;
    if (!workbook) {
      throw new Error("The spreadsheet is not ready yet.");
    }
    const sheet = workbook.getActiveSheet();
    const activeSheetId = sheet.getSheetId();
    workbook
      .getSheets()
      .filter((workbookSheet) => workbookSheet.getSheetId() !== activeSheetId)
      .forEach((workbookSheet) => workbook.deleteSheet(workbookSheet));
    sheet.getRange("A1:T1000").clearContent();
    initializeEmployeeSheet(sheet);
    workbook.setActiveSheet(sheet);
    sheet.setActiveRange(sheet.getRange("A2"));
    sheet.scrollToCell(1, 0, 250);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workbook.save()));
    setStatus("New blank employee sheet ready");
    toast.add({
      type: "success",
      title: "New blank employee record ready",
      description:
        "The previous spreadsheet draft was cleared. Employees already added to payroll are not deleted.",
    });
  };

  const saveEmployeesToBackend = async () => {
    if (!selectedCompanyId) {
      throw new Error("Create or select a company before saving employees.");
    }

    const workbook = workbookRef.current;
    if (!workbook) throw new Error("The spreadsheet is not ready yet.");
    const sheet = workbook.getActiveSheet();
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0] ?? [];
    const backendIdColumn = headers.findIndex((header) =>
      FIELD_HEADERS.backendId.includes(normalizeHeader(header)),
    );
    if (backendIdColumn < 0) {
      throw new Error(
        "The spreadsheet needs a blank Employee ID column to track which employees have been added. Import it again with fewer columns.",
      );
    }
    const employeeRecords = rows.slice(1).map((cells, index) => ({
      sheetRow: index + 2,
      values: cells,
    }));
    const unsavedRows = employeeRecords.filter(
      ({ values }) =>
        !values[backendIdColumn] &&
        values.some(
          (value, columnIndex) =>
            columnIndex !== backendIdColumn &&
            value !== null &&
            value !== undefined &&
            value !== "",
        ),
    );
    const readyRows = [];
    let incompleteRows = 0;

    for (const record of unsavedRows) {
      const { values, sheetRow } = record;
      const fullName = String(getFieldValue(values, headers, "fullName") ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const firstName =
        String(getFieldValue(values, headers, "firstName") ?? "").trim() ||
        fullName[0] ||
        "";
      const lastName =
        String(getFieldValue(values, headers, "lastName") ?? "").trim() ||
        (fullName.length > 1 ? fullName.at(-1) : "");
      const amounts = [
        getFieldValue(values, headers, "baseSalary"),
        getFieldValue(values, headers, "dailyRate"),
        getFieldValue(values, headers, "hourlyRate"),
      ].map((value) =>
        Number(String(value).replace(/[,\s$₱]/g, "")),
      );
      const requiredValues = [
        firstName,
        lastName,
        String(getFieldValue(values, headers, "dateHired") ?? "").trim(),
        String(
          getFieldValue(values, headers, "socialSecurityNumber") ?? "",
        ).trim(),
        String(getFieldValue(values, headers, "pagIbigID") ?? "").trim(),
        String(getFieldValue(values, headers, "philhealth") ?? "").trim(),
        String(getFieldValue(values, headers, "taxIdNumber") ?? "").trim(),
      ];
      if (
        requiredValues.some((value) => !value) ||
        amounts.some((amount) => !Number.isFinite(amount) || amount <= 0)
      ) {
        incompleteRows += 1;
        continue;
      }

      const type = String(
        getFieldValue(values, headers, "employmentType") ?? "",
      ).toLowerCase();
      const employmentType = type.includes("contract")
        ? "CONTRACT"
        : type.includes("part")
          ? "PART_TIME"
          : "REGULAR";
      const employmentStatus = String(
        getFieldValue(values, headers, "employmentStatus") || "ACTIVE",
      )
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
      const optionalText = (field) =>
        String(getFieldValue(values, headers, field) ?? "").trim() || null;

      readyRows.push({
        sheetRow,
        body: {
          firstname: firstName,
          middlename:
            optionalText("middleName") ||
            (fullName.length > 2 ? fullName.slice(1, -1).join(" ") : null),
          lastname: lastName,
          extname: optionalText("extension"),
          birthdate: optionalText("birthdate"),
          gender: optionalText("gender"),
          civilStatus: optionalText("civilStatus") || "SINGLE",
          email: optionalText("email"),
          phone: optionalText("phone"),
          address: optionalText("address"),
          employmentType,
          employmentStatus,
          dateHired: String(
            getFieldValue(values, headers, "dateHired"),
          ).trim(),
          department: optionalText("department"),
          position: optionalText("position"),
          socialSecurityNumber: requiredValues[3],
          pagIbigID: requiredValues[4],
          philhealth: requiredValues[5],
          taxIdNumber: requiredValues[6],
          baseSalaryCents: Math.round(amounts[0] * 100),
          dailyRateCents: Math.round(amounts[1] * 100),
          hourlyRateCents: Math.round(amounts[2] * 100),
        },
      });
    }

    if (readyRows.length === 0) {
      if (unsavedRows.length === 0) {
        setStatus("No new employees to add");
        toast.add({
          type: "info",
          title: "No new employees to add",
          description: "All employees in this spreadsheet have already been added.",
        });
      } else {
        setStatus(
          `No employees were added. Complete the required details in ${incompleteRows} rows and try again.`,
        );
        toast.add({
          type: "warning",
          title: "No employees were added",
          description: `Complete the required fields in ${incompleteRows} row${incompleteRows === 1 ? "" : "s"} and try again.`,
        });
      }
      return;
    }

    setIsSavingToBackend(true);
    backendSaveRef.current = true;
    setServerError("");
    setStatus(`Adding ${readyRows.length} employee${readyRows.length === 1 ? "" : "s"} to payroll…`);
    let savedCount = 0;
    const uploadToastId = toast.add({
      type: "loading",
      title: "Adding employees to payroll",
      description: `Adding ${readyRows.length} employee${readyRows.length === 1 ? "" : "s"} to payroll…`,
      timeout: 0,
    });
    try {
      for (
        let start = 0;
        start < readyRows.length;
        start += EMPLOYEE_BATCH_SIZE
      ) {
        const batch = readyRows.slice(start, start + EMPLOYEE_BATCH_SIZE);
        const batchEnd = start + batch.length;
        const progressText = `Adding ${batchEnd} of ${readyRows.length} employees to payroll…`;
        setStatus(progressText);
        toast.update(uploadToastId, { description: progressText });

        const result = await apiRequest("/api/employees/batch", {
          method: "POST",
          body: {
            companyId: selectedCompanyId,
            employees: batch.map(({ body }) => body),
          },
        });
        if (
          !Array.isArray(result?.data) ||
          result.data.length !== batch.length ||
          result.data.some((employee) => typeof employee?.id !== "string")
        ) {
          throw new Error(
            `The server did not confirm every employee in rows ${start + 1}-${batchEnd}. Check your employee list before retrying.`,
          );
        }

        result.data.forEach((employee, index) => {
          sheet
            .getRange(
              `${columnName(backendIdColumn)}${batch[index].sheetRow}`,
            )
            .setValue(employee.id);
        });
        savedCount += result.data.length;
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(workbook.save()),
        );
      }

      setStatus(
        `${savedCount} employee${savedCount === 1 ? "" : "s"} added${
          incompleteRows
            ? `; ${incompleteRows} incomplete row${incompleteRows === 1 ? "" : "s"} skipped`
            : ""
        }`,
      );
      toast.update(uploadToastId, {
        type: incompleteRows ? "warning" : "success",
        title: incompleteRows ? "Employees added with incomplete rows skipped" : "Employees added to payroll",
        description: `${savedCount} employee${savedCount === 1 ? "" : "s"} added${incompleteRows ? `; ${incompleteRows} row${incompleteRows === 1 ? "" : "s"} skipped because required details are missing` : ""}.`,
      });
    } catch (saveError) {
      setStatus("Employee addition incomplete");
      const errorMessage =
        saveError instanceof Error
          ? saveError.message
          : "Could not add employees.";
      setServerError(
        `${savedCount} employee${savedCount === 1 ? "" : "s"} added before the problem: ${errorMessage}`,
      );
      toast.update(uploadToastId, {
        type: "error",
        title: savedCount ? "Some employees could not be added" : "Could not add employees to payroll",
        description: `${savedCount} employee${savedCount === 1 ? "" : "s"} added. ${errorMessage}`,
      });
    } finally {
      backendSaveRef.current = false;
      setIsSavingToBackend(false);
    }
  };

  const runEmployeeAction = async (actionId) => {
    setServerError("");
    try {
      if (actionId === "new-record") {
        createNewEmployeeRecord();
      } else if (actionId === "import") {
        csvInputRef.current?.click();
      } else if (actionId === "add") {
        await saveEmployeesToBackend();
      } else if (actionId === "undo" || actionId === "redo") {
        const api = univerApiRef.current;
        if (!api) throw new Error("The spreadsheet is not ready yet.");
        await api[actionId]();
      } else if (actionId === "copy" || actionId === "paste") {
        const api = univerApiRef.current;
        if (!api) throw new Error("The spreadsheet is not ready yet.");
        await api[actionId]();
      } else if (actionId === "cut") {
        const api = univerApiRef.current;
        if (!api) throw new Error("The spreadsheet is not ready yet.");
        api.getShortcut().triggerShortcut(
          new KeyboardEvent("keydown", {
            key: "x",
            ctrlKey: true,
            keyCode: api.Enum.KeyCode.X,
          }),
        );
      } else if (actionId === "export") {
        const workbook = workbookRef.current;
        if (!workbook) throw new Error("The spreadsheet is not ready yet.");
        const XLSX = await import("xlsx");
        const data = workbook.getActiveSheet().getDataRange().getValues();
        const exportWorkbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(exportWorkbook, worksheet, "Employees");
        XLSX.writeFile(exportWorkbook, "employees.xlsx");
      } else if (actionId === "gridlines") {
        const workbook = workbookRef.current;
        const sheet = workbook?.getActiveSheet();
        const api = univerApiRef.current;
        if (!workbook || !sheet || !api) {
          throw new Error("The spreadsheet is not ready yet.");
        }
        await api.executeCommand("sheet.command.toggle-gridlines", {
          unitId: workbook.getId(),
          subUnitId: sheet.getSheetId(),
        });
      } else if (actionId === "help") {
        toast.add({
          type: "info",
          title: "Preparing the employee spreadsheet",
          description:
            "Complete each employee’s required payroll details, then choose Add employees to payroll. Changes to this spreadsheet are saved on this computer.",
        });
      }
    } catch (actionError) {
      setServerError(
        actionError instanceof Error
          ? actionError.message
          : "Could not complete the spreadsheet action.",
      );
    }
  };

  return (
    <SidebarProvider className="h-full min-h-0 bg-background">
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
          <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg border">
            <LayoutDashboard className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold">Payroll</p>
            <p className="truncate text-xs text-muted-foreground">
              Admin workspace
            </p>
          </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map(({ label, href, Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={<Link to={href} />}
                    isActive={href === "/createEmployees"}
                    tooltip={label}
                  >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="h-full min-h-0 bg-muted/30">
        <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2 md:p-3">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <h1 className="text-lg font-semibold tracking-tight">Employees</h1>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            Company
            <select
              value={selectedCompanyId}
              onChange={(event) => {
                const companyId = event.target.value;
                setSelectedCompanyId(companyId);
                if (companyId) {
                  window.localStorage.setItem(SELECTED_COMPANY_KEY, companyId);
                } else {
                  window.localStorage.removeItem(SELECTED_COMPANY_KEY);
                }
              }}
              disabled={!companies.length}
              className="h-8 min-w-48 rounded-md border bg-background px-3 font-normal"
            >
              {companies.length ? (
                companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))
              ) : (
                <option value="">
                  {isLoadingCompanies ? "Loading companies…" : "No company available"}
                </option>
              )}
            </select>
          </label>
          <p className="text-xs text-muted-foreground" role="status">
            {status}
          </p>
        </header>

        {(companyError || serverError) && (
          <p role="alert" className="shrink-0 text-sm text-destructive">
            {companyError || serverError}
          </p>
        )}

        {!companies.length && !isLoadingCompanies && !companyError && (
          <p className="shrink-0 text-sm text-muted-foreground">
            No company is set up yet.{" "}
            <Link to="/dashboard" className="font-medium underline">
              Set up a company
            </Link>{" "}
            before adding employees to payroll.
          </p>
        )}

        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          aria-label="Upload an Excel or CSV file to the spreadsheet"
          onChange={(event) =>
            uploadSpreadsheetFile(event.target.files?.[0])
          }
        />
        <input
          ref={payrollImportInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          aria-label="Select an employee roster to import directly to payroll"
          onChange={(event) =>
            importEmployeeFileToPayroll(event.target.files?.[0])
          }
        />

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b pb-1">
          <Menubar className="h-9 rounded-md border-0 p-0">
            <MenubarMenu>
              <MenubarTrigger>File</MenubarTrigger>
              <MenubarContent style={{ width: "17rem" }}>
                <MenubarItem
                  className="whitespace-nowrap"
                  onClick={() => runEmployeeAction("new-record")}
                >
                  <FilePlus2 aria-hidden="true" />
                  New Record
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem
                  className="whitespace-nowrap"
                  onClick={() => runEmployeeAction("import")}
                >
                  <FileUp aria-hidden="true" />
                  Upload Record…
                </MenubarItem>
                <MenubarItem
                  className="whitespace-nowrap"
                  disabled={isSavingToBackend || !selectedCompanyId}
                  onClick={() => payrollImportInputRef.current?.click()}
                >
                  <CloudUpload aria-hidden="true" />
                  Import roster to payroll…
                </MenubarItem>
                <MenubarItem
                  className="whitespace-nowrap"
                  onClick={saveWorkbook}
                >
                  <Save aria-hidden="true" />
                  Save
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem
                  className="whitespace-nowrap"
                  onClick={() => runEmployeeAction("export")}
                >
                  <Download aria-hidden="true" />
                  Download a copy as Excel…
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>Edit</MenubarTrigger>
              <MenubarContent>
                <MenubarItem onClick={() => runEmployeeAction("undo")}>
                  <Undo2 aria-hidden="true" />
                  Undo
                </MenubarItem>
                <MenubarItem onClick={() => runEmployeeAction("redo")}>
                  <Redo2 aria-hidden="true" />
                  Redo
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem onClick={() => runEmployeeAction("cut")}>
                  Cut
                </MenubarItem>
                <MenubarItem onClick={() => runEmployeeAction("copy")}>
                  Copy
                </MenubarItem>
                <MenubarItem onClick={() => runEmployeeAction("paste")}>
                  Paste
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>View</MenubarTrigger>
              <MenubarContent>
                <MenubarItem onClick={() => runEmployeeAction("gridlines")}>
                  Toggle gridlines
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>Help</MenubarTrigger>
              <MenubarContent>
                <MenubarItem onClick={() => runEmployeeAction("help")}>
                  Employee spreadsheet guide
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
          <Button
            onClick={() => runEmployeeAction("add")}
            disabled={isSavingToBackend || !selectedCompanyId}
            className="h-9"
          >
            {isSavingToBackend ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <CloudUpload aria-hidden="true" />
            )}
            {isSavingToBackend ? "Adding employees…" : "Add employees to payroll"}
          </Button>
        </div>

        {error ? (
          <section
            className="rounded-lg border border-destructive/30 bg-background p-4 text-sm text-destructive"
            role="alert"
          >
            Could not load the employee spreadsheet: {error}
          </section>
        ) : (
          <section className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
            <div
              ref={containerRef}
              className="h-full min-h-0 w-full"
              aria-label="Editable employee spreadsheet"
            />
          </section>
        )}
      </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
