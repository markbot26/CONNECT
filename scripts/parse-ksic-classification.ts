/**
 * Parse Official Korean Standard Industrial Classification (KSIC) Excel File
 *
 * Extracts the official classification structure from the Hometax KSIC mapping file
 */

// @ts-ignore - xlsx is an optional dependency for this standalone script
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const excelFilePath = '/Users/paulkim/Downloads/업종코드-표준산업분류 연계표_홈택스 게시.xlsx';

async function parseKSICClassification() {
  console.log('📊 Parsing Official KSIC Classification from Excel File\n');
  console.log('='.repeat(80));

  try {
    // 1. Read Excel file
    console.log('\n📂 Reading Excel file...');
    const workbook = XLSX.readFile(excelFilePath);

    console.log(`   Sheets found: ${workbook.SheetNames.join(', ')}`);

    // 2. Parse first sheet
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    console.log(`\n📋 Parsing sheet: "${firstSheetName}"`);

    // Convert to JSON
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    console.log(`   Total rows: ${jsonData.length}`);
    console.log(`\n   First 10 rows (header preview):`);
    jsonData.slice(0, 10).forEach((row, idx) => {
      console.log(`   [${idx}] ${JSON.stringify(row).substring(0, 150)}${JSON.stringify(row).length > 150 ? '...' : ''}`);
    });

    // 3. Identify column structure
    console.log('\n\n' + '='.repeat(80));
    console.log('🔍 Analyzing Column Structure\n');

    // The actual headers appear to be in row 4 (index 4)
    // Row 0: Empty
    // Row 1: Title
    // Row 2: Empty
    // Row 3: Partial headers
    // Row 4: Full headers
    const headerRowIndex = 4;
    const dataStartIndex = 5;

    const headers = jsonData[headerRowIndex] || [];
    console.log(`   Using row ${headerRowIndex} as headers`);
    console.log(`   Data starts from row ${dataStartIndex}`);
    console.log('   Column Headers:');
    headers.forEach((header: any, idx: number) => {
      console.log(`   [${idx}] ${header}`);
    });

    // 4. Extract classification data
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 Extracting KSIC Classification Data\n');

    interface KSICRecord {
      code?: string;
      majorCategory?: string;
      mediumCategory?: string;
      minorCategory?: string;
      detailCategory?: string;
      description?: string;
      [key: string]: any;
    }

    const classifications: KSICRecord[] = [];

    // Skip header rows, process data rows from index 5
    for (let i = dataStartIndex; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;

      const record: KSICRecord = {};
      headers.forEach((header: any, idx: number) => {
        const value = row[idx];
        if (value !== undefined && value !== null && value !== '') {
          record[header] = value;
        }
      });

      if (Object.keys(record).length > 0) {
        classifications.push(record);
      }
    }

    console.log(`   Total classification records: ${classifications.length}`);

    // 5. Analyze major categories (대분류)
    console.log('\n\n' + '='.repeat(80));
    console.log('📈 Major Category Analysis\n');

    // Find unique major categories
    const majorCategories = new Map<string, Set<string>>();

    classifications.forEach(record => {
      // Try to identify major category field (usually first code or section letter)
      const possibleMajorFields = Object.keys(record).filter(key =>
        key.includes('대분류') ||
        key.includes('코드') ||
        key.includes('분류')
      );

      possibleMajorFields.forEach(field => {
        const value = String(record[field]);
        if (value && value.length > 0) {
          if (!majorCategories.has(field)) {
            majorCategories.set(field, new Set());
          }
          majorCategories.get(field)!.add(value);
        }
      });
    });

    majorCategories.forEach((values, field) => {
      console.log(`\n   Field: "${field}" (${values.size} unique values)`);
      const sortedValues = Array.from(values).sort().slice(0, 20);
      sortedValues.forEach(val => {
        const count = classifications.filter(r => r[field] === val).length;
        console.log(`      ${val}: ${count} records`);
      });
      if (values.size > 20) {
        console.log(`      ... and ${values.size - 20} more`);
      }
    });

    // 6. Sample records for each major category
    console.log('\n\n' + '='.repeat(80));
    console.log('📋 Sample Records by Major Category\n');

    // Group by first field that looks like a major category
    const firstCategoryField = Array.from(majorCategories.keys())[0];
    if (firstCategoryField) {
      const grouped = new Map<string, KSICRecord[]>();

      classifications.forEach(record => {
        const category = String(record[firstCategoryField] || 'UNKNOWN');
        if (!grouped.has(category)) {
          grouped.set(category, []);
        }
        grouped.get(category)!.push(record);
      });

      // Show samples from first 10 categories
      const sortedCategories = Array.from(grouped.keys()).sort().slice(0, 10);
      sortedCategories.forEach(category => {
        const records = grouped.get(category)!;
        console.log(`\n▸ ${category} (${records.length} records):`);
        records.slice(0, 3).forEach((record, idx) => {
          console.log(`   ${idx + 1}. ${JSON.stringify(record)}`);
        });
        if (records.length > 3) {
          console.log(`   ... and ${records.length - 3} more records`);
        }
      });
    }

    // 7. Export to JSON for further analysis
    console.log('\n\n' + '='.repeat(80));
    console.log('💾 Exporting to JSON\n');

    const outputPath = '/Users/paulkim/Downloads/connect/data/ksic-classification.json';
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(
      outputPath,
      JSON.stringify({
        headers,
        classifications,
        metadata: {
          sourceFile: excelFilePath,
          totalRecords: classifications.length,
          extractedAt: new Date().toISOString(),
        }
      }, null, 2)
    );

    console.log(`   ✅ Exported to: ${outputPath}`);
    console.log(`   Total records: ${classifications.length}`);

    console.log('\n' + '='.repeat(80));
    console.log('✅ KSIC Classification Extraction Complete\n');

  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    console.error('Stack:', error.stack);
  }
}

parseKSICClassification();
