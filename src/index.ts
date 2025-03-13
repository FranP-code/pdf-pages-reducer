import inquirer from "inquirer";
import { PDFDocument, degrees } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";

// Extend the orientation type to include "stacked"
type OrientationType = "horizontal" | "vertical" | "stacked";

interface Answers {
	operation: string;
	pdfPath: string;
	copies: number;
	orientation: OrientationType;
	specifyPaperSize: boolean;
	selectedSize: [number, number];
}

// -------------- Existing duplicate function --------------
async function duplicatePages(
	inputPath: string,
	copies: number
): Promise<Uint8Array> {
	const pdfBytes = fs.readFileSync(inputPath);
	const pdfDoc = await PDFDocument.load(pdfBytes);
	const pageCount = pdfDoc.getPageCount();

	for (let i = 0; i < pageCount; i++) {
		// For each page, insert (copies-1) additional copies after it
		for (let j = 0; j < copies - 1; j++) {
			const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [i]);
			pdfDoc.insertPage(i + 1 + j, copiedPage);
		}
	}

	return pdfDoc.save();
}

// -------------- Updated 2-up function --------------
async function combinePages2In1(
	inputPath: string,
	orientation: OrientationType,
	paperSize?: [number, number]
): Promise<Uint8Array> {
	// 1) Load the input PDF
	const pdfBytes = fs.readFileSync(inputPath);
	const originalPdf = await PDFDocument.load(pdfBytes);

	// 2) Create a new PDFDocument for the 2-up output
	const newPdf = await PDFDocument.create();

	// 3) Decide final page size (portrait)
	let finalWidth: number;
	let finalHeight: number;
	if (paperSize) {
		[finalWidth, finalHeight] = paperSize; // e.g. [595.28, 841.89] for A4
	} else {
		// Default to A4 if none chosen
		finalWidth = 595.28;
		finalHeight = 841.89;
	}

	// 4) For each page in the original PDF, add a new 2-up page
	const pageCount = originalPdf.getPageCount();
	for (let i = 0; i < pageCount; i++) {
		// Add a blank page in the new PDF
		const newPage = newPdf.addPage([finalWidth, finalHeight]);

		// Copy the same page twice
		const [origPage1] = await newPdf.copyPages(originalPdf, [i]);
		const [origPage2] = await newPdf.copyPages(originalPdf, [i]);

		// Embed them
		const embedded1 = await newPdf.embedPage(origPage1);
		const embedded2 = await newPdf.embedPage(origPage2);

		// Original size
		const { width: w, height: h } = origPage1.getSize();

		if (orientation === "vertical") {
			// ---------------------------------------------------
			// "VERTICAL" = side-by-side (left/right)
			// ---------------------------------------------------
			//
			//  ┌─────────┬─────────┐
			//  │ Page1   │  Page2  │
			//  └─────────┴─────────┘
			//
			// Each half is finalWidth/2 wide, finalHeight tall.
			// Use "contain" scaling so each page fits entirely.

			const slotWidth = finalWidth / 2;
			const slotHeight = finalHeight;
			const scale = Math.min(slotWidth / w, slotHeight / h);

			const scaledW = w * scale;
			const scaledH = h * scale;

			// Left slot offsets
			const offsetX1 = (slotWidth - scaledW) / 2;
			const offsetY1 = (slotHeight - scaledH) / 2;

			newPage.drawPage(embedded1, {
				x: offsetX1,
				y: offsetY1,
				xScale: scale,
				yScale: scale,
			});

			// Right slot offsets
			const offsetX2 = slotWidth + (slotWidth - scaledW) / 2;
			const offsetY2 = offsetY1;

			newPage.drawPage(embedded2, {
				x: offsetX2,
				y: offsetY2,
				xScale: scale,
				yScale: scale,
			});
		} else if (orientation === "horizontal") {
			// ---------------------------------------------------
			// "HORIZONTAL" = top & bottom WITH rotation
			// ---------------------------------------------------
			//
			//  ┌─────────┐  (top half)
			//  │ Page1   │  rotated +90
			//  ├─────────┤
			//  │ Page2   │  rotated +90
			//  └─────────┘  (bottom half)
			//
			// Each half is finalWidth wide, finalHeight/2 tall.
			// We rotate each original page so it appears landscape.

			const slotWidth = finalWidth;
			const slotHeight = finalHeight / 2;

			// After a +90 rotation, the bounding box is effectively (h × w).
			const scale = Math.min(slotWidth / h, slotHeight / w);

			// We'll shift x by + h*scale so the rotated page remains in view
			// and center it within the slot.

			// Page1 in the TOP half
			const offsetX1 = (slotWidth - h * scale) / 2;
			const offsetY1 = slotHeight + (slotHeight - w * scale) / 2;

			newPage.drawPage(embedded1, {
				x: offsetX1 + h * scale,
				y: offsetY1,
				xScale: scale,
				yScale: scale,
				rotate: degrees(90),
			});

			// Page2 in the BOTTOM half
			const offsetX2 = (slotWidth - h * scale) / 2;
			const offsetY2 = (slotHeight - w * scale) / 2;

			newPage.drawPage(embedded2, {
				x: offsetX2 + h * scale,
				y: offsetY2,
				xScale: scale,
				yScale: scale,
				rotate: degrees(90),
			});
		} else {
			// ---------------------------------------------------
			// "STACKED" = top & bottom WITHOUT rotation
			// ---------------------------------------------------
			//
			//  ┌─────────┐  (top half)
			//  │ Page1   │  normal orientation
			//  ├─────────┤
			//  │ Page2   │  normal orientation
			//  └─────────┘  (bottom half)
			//
			// Each half is finalWidth wide, finalHeight/2 tall.
			// We do not rotate. We simply scale to fit.

			const slotWidth = finalWidth;
			const slotHeight = finalHeight / 2;
			const scale = Math.min(slotWidth / w, slotHeight / h);

			const scaledW = w * scale;
			const scaledH = h * scale;

			// Place Page1 in the top half
			// top half's y-range is [slotHeight, finalHeight]
			const offsetX1 = (slotWidth - scaledW) / 2;
			const offsetY1 = slotHeight + (slotHeight - scaledH) / 2;

			newPage.drawPage(embedded1, {
				x: offsetX1,
				y: offsetY1,
				xScale: scale,
				yScale: scale,
			});

			// Place Page2 in the bottom half
			const offsetX2 = (slotWidth - scaledW) / 2;
			const offsetY2 = (slotHeight - scaledH) / 2;

			newPage.drawPage(embedded2, {
				x: offsetX2,
				y: offsetY2,
				xScale: scale,
				yScale: scale,
			});
		}
	}

	// 5) Save and return
	return newPdf.save();
}

// -------------- Updated main() --------------
async function main() {
	try {
		// 1) Check if PDF path is provided as a command-line argument
		let pdfPath: string | undefined = process.argv[2];

		// 2) If not provided, prompt for PDF path
		if (!pdfPath) {
			const answer = await inquirer.prompt<Pick<Answers, "pdfPath">>({
				type: "input",
				name: "pdfPath",
				message: "Enter the path to your PDF file:",
				validate: async (input: string) => {
					try {
						fs.existsSync(input);
						return (
							path.extname(input).toLowerCase() === ".pdf" ||
							"Please provide a PDF file"
						);
					} catch {
						return "File does not exist";
					}
				},
			});
			pdfPath = answer.pdfPath;
		} else {
			// Validate the provided PDF path
			if (
				!fs.existsSync(pdfPath) ||
				path.extname(pdfPath).toLowerCase() !== ".pdf"
			) {
				console.error("Invalid PDF path provided as argument.");
				return;
			}
		}

		// 3) Ask user what operation to perform
		const { operation } = await inquirer.prompt<Pick<Answers, "operation">>({
			type: "list",
			name: "operation",
			message: "What operation would you like to perform?",
			choices: ["Duplicate PDF pages", "Combine pages 2 in 1"],
		});

		// 4) Perform the chosen operation
		if (operation === "Duplicate PDF pages") {
			// Ask how many copies
			const { copies } = await inquirer.prompt<Pick<Answers, "copies">>({
				type: "number",
				name: "copies",
				message: "How many copies of each page do you want?",
				validate: (input?: number) =>
					(input && input > 0) || "Please enter a number greater than 0",
			});

			// Output path for duplicated pages
			const outputPath = path.join(
				path.dirname(pdfPath),
				`${path.basename(pdfPath, ".pdf")}_duplicated.pdf`
			);

			// Duplicate
			const pdfBytes = await duplicatePages(pdfPath, copies);
			fs.writeFileSync(outputPath, pdfBytes);

			console.log(`Success! Output saved to: ${outputPath}`);
		} else {
			// "Combine pages 2 in 1"

			// 4.1) Ask orientation
			//   - "vertical" => side by side
			//   - "horizontal" => top/bottom with rotation
			//   - "stacked" => top/bottom no rotation
			const { orientation } = await inquirer.prompt<
				Pick<Answers, "orientation">
			>({
				type: "list",
				name: "orientation",
				message: "Select arrangement (affects content placement):",
				choices: [
					{ name: "Vertical (side-by-side)", value: "vertical" },
					{ name: "Horizontal (top/bottom, rotated)", value: "horizontal" },
					{ name: "Stacked (top/bottom, no rotation)", value: "stacked" },
				],
			});

			// 4.2) Ask if user wants to specify a paper size
			const { specifyPaperSize } = await inquirer.prompt<
				Pick<Answers, "specifyPaperSize">
			>({
				type: "confirm",
				name: "specifyPaperSize",
				message: "Would you like to choose a common paper size for the output?",
				default: false,
			});

			let chosenPaperSize: [number, number] | undefined = undefined;
			if (specifyPaperSize) {
				const { selectedSize } = await inquirer.prompt<
					Pick<Answers, "selectedSize">
				>({
					type: "list",
					name: "selectedSize",
					message: "Select a paper size (output will be portrait):",
					choices: [
						{ name: "A4 (210 × 297 mm)", value: [595.28, 841.89] },
						{ name: "Letter (8.5 × 11 in)", value: [612, 792] },
						{ name: "Legal (8.5 × 14 in)", value: [612, 1008] },
						{ name: "A3 (297 × 420 mm)", value: [841.89, 1190.55] },
						{ name: "Tabloid (11 × 17 in)", value: [792, 1224] },
					],
				});
				chosenPaperSize = selectedSize;
			}

			// 4.3) Output path
			const outputPath = path.join(
				path.dirname(pdfPath),
				`${path.basename(pdfPath, ".pdf")}_2up.pdf`
			);

			// 4.4) Generate the 2-up PDF
			const pdfBytes = await combinePages2In1(
				pdfPath,
				orientation,
				chosenPaperSize
			);
			fs.writeFileSync(outputPath, pdfBytes);

			console.log(`Success! 2-up PDF saved to: ${outputPath}`);
		}
	} catch (error) {
		console.error("An error occurred:", error);
	}
}

main();
