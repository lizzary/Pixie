import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import router from './router/router';
import { ToastProvider } from './components/Toast';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ToastProvider>
    <RouterProvider router={router} />
  </ToastProvider>
);