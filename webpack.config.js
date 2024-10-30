const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './src/main.ts',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.(wgsl|vs|fs)$/,
        loader: 'ts-shader-loader'
      }
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },

  plugins: [
    new CopyWebpackPlugin({
        patterns: [
          { from: 'public', to: '' },  // Copy all files
        ],
      }),
  ],


  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  }
};
