import * as esbuild from 'esbuild';

await esbuild.build({
	entryPoints: ['src/main.ts'],
	bundle: true,
	minify: true,
	sourcemap: false,
	target: ['es2020'],
	outfile: '../html/js/nagios-app.js',
	logLevel: 'info',
});
