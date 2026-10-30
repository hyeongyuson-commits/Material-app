import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Plus, Package, ArrowDownToLine, ArrowUpFromLine, 
  Box, Trash2, AlertCircle, TrendingUp, History, ClipboardList,
  Layers, Edit
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch } from 'firebase/firestore';

// --- Firebase Initialization ---
let app, auth, db;
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

if (firebaseConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [logs, setLogs] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [assemblySearchQuery, setAssemblySearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'inventory' | 'assemblies' | 'history'
  
  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState(null);
  const [transactionModal, setTransactionModal] = useState({ isOpen: false, type: null, material: null });

  // Assembly Modals state
  const [isAddAssemblyModalOpen, setIsAddAssemblyModalOpen] = useState(false);
  const [isEditAssemblyModalOpen, setIsEditAssemblyModalOpen] = useState(false);
  const [editAssemblyData, setEditAssemblyData] = useState(null);
  const [newAssembly, setNewAssembly] = useState({ name: '', components: [], completedStock: 0 });
  const [shipModal, setShipModal] = useState({ isOpen: false, assembly: null, count: 1, type: 'complete', note: '' }); // type: 'complete' | 'ship'
  const [shipError, setShipError] = useState('');
  const [componentSearchText, setComponentSearchText] = useState('');
  const [editComponentSearchText, setEditComponentSearchText] = useState('');

  // Add Form state
  const [formData, setFormData] = useState({
    code: '', name: '', spec: '', unit: '', stock: 0, totalConsumed: 0, note: ''
  });

  // Transaction Form state
  const [transactionAmount, setTransactionAmount] = useState('');
  const [transactionNote, setTransactionNote] = useState('');

  // --- Firebase Auth & Data Fetching ---
  useEffect(() => {
    if (!auth) {
      setIsLoading(false);
      return;
    }

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;

    const materialsRef = collection(db, 'artifacts', appId, 'public', 'data', 'materials');
    
    const unsubscribeMaterials = onSnapshot(materialsRef, (snapshot) => {
      const fetchedMaterials = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      fetchedMaterials.sort((a, b) => b.updatedAt - a.updatedAt);
      setMaterials(fetchedMaterials);
      setIsLoading(false);
    }, (error) => {
      console.error("Fetch error:", error);
      setIsLoading(false);
    });

    const logsRef = collection(db, 'artifacts', appId, 'public', 'data', 'logs');
    const unsubscribeLogs = onSnapshot(logsRef, (snapshot) => {
      const fetchedLogs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      fetchedLogs.sort((a, b) => b.timestamp - a.timestamp);
      setLogs(fetchedLogs);
    });

    const assembliesRef = collection(db, 'artifacts', appId, 'public', 'data', 'assemblies');
    const unsubscribeAssemblies = onSnapshot(assembliesRef, (snapshot) => {
      const fetchedAssemblies = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      fetchedAssemblies.sort((a, b) => b.createdAt - a.createdAt);
      setAssemblies(fetchedAssemblies);
    });

    return () => {
      unsubscribeMaterials();
      unsubscribeLogs();
      unsubscribeAssemblies();
    };
  }, [user]);

  // --- Dashboard Monitoring Pinned Items State ---
  const [pinnedItems, setPinnedItems] = useState(() => {
    const saved = localStorage.getItem('dashboard_pinned_items');
    return saved ? JSON.parse(saved) : [];
  });
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pinSearchType, setPinSearchType] = useState('material'); // 'material' or 'assembly'

  useEffect(() => {
    localStorage.setItem('dashboard_pinned_items', JSON.stringify(pinnedItems));
  }, [pinnedItems]);

  const handleTogglePin = (id, type) => {
    const exists = pinnedItems.some(p => p.id === id && p.type === type);
    if (exists) {
      setPinnedItems(pinnedItems.filter(p => !(p.id === id && p.type === type)));
    } else {
      setPinnedItems([...pinnedItems, { id, type }]);
    }
  };

  // --- Handlers ---
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!user || !db) return;

    const newId = formData.code || Date.now().toString(); 
    const materialRef = doc(db, 'artifacts', appId, 'public', 'data', 'materials', newId);
    
    await setDoc(materialRef, {
      ...formData,
      stock: Number(formData.stock),
      totalConsumed: 0,
      updatedAt: Date.now()
    });

    setIsAddModalOpen(false);
    setFormData({ code: '', name: '', spec: '', unit: '', stock: 0, totalConsumed: 0, note: '' });
  };

  const handleTransactionSubmit = async (e) => {
    e.preventDefault();
    if (!user || !db || !transactionModal.material) return;

    const amount = Number(transactionAmount);
    if (amount <= 0) return;

    const targetMaterial = materials.find(m => m.id === transactionModal.material.id);
    if (!targetMaterial) return;

    const materialRef = doc(db, 'artifacts', appId, 'public', 'data', 'materials', targetMaterial.id);
    const currentStock = Number(targetMaterial.stock) || 0;
    
    let newStock = currentStock;
    let newTotalConsumed = Number(targetMaterial.totalConsumed) || 0;

    if (transactionModal.type === 'in') {
      newStock += amount;
    } else if (transactionModal.type === 'out') {
      if (currentStock < amount) {
        alert('현재고보다 출고 수량이 많습니다.');
        return;
      }
      newStock = Math.max(0, currentStock - amount);
      newTotalConsumed += amount;
    }

    const logRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'logs'));
    await setDoc(logRef, {
      materialId: targetMaterial.id,
      materialName: targetMaterial.name,
      type: transactionModal.type,
      quantity: amount,
      note: transactionNote,
      timestamp: Date.now()
    });

    await setDoc(materialRef, {
      ...targetMaterial,
      stock: newStock,
      totalConsumed: newTotalConsumed,
      updatedAt: Date.now()
    });

    setTransactionModal({ isOpen: false, type: null, material: null });
    setTransactionAmount('');
    setTransactionNote('');
  };

  const handleDelete = async (id) => {
    if (!user || !db) return;
    const materialRef = doc(db, 'artifacts', appId, 'public', 'data', 'materials', id);
    await deleteDoc(materialRef);
  };

  const openEditMaterial = (material) => {
    setEditFormData({ ...material });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!user || !db || !editFormData) return;

    const materialRef = doc(db, 'artifacts', appId, 'public', 'data', 'materials', editFormData.id);
    await setDoc(materialRef, {
      ...editFormData,
      updatedAt: Date.now()
    }, { merge: true });

    setIsEditModalOpen(false);
    setEditFormData(null);
  };

  // --- Assembly Handlers ---
  const handleAddAssemblyComponent = () => {
    setNewAssembly({
      ...newAssembly,
      components: [...newAssembly.components, { materialId: '', requiredQty: 1 }]
    });
  };

  const handleAssemblyComponentChange = (index, field, value) => {
    const updatedComponents = [...newAssembly.components];
    updatedComponents[index][field] = value;
    setNewAssembly({ ...newAssembly, components: updatedComponents });
  };

  const handleRemoveAssemblyComponent = (index) => {
    const updatedComponents = [...newAssembly.components];
    updatedComponents.splice(index, 1);
    setNewAssembly({ ...newAssembly, components: updatedComponents });
  };

  const handleSaveAssembly = async (e) => {
    e.preventDefault();
    if (!user || !db) return;
    if (!newAssembly.name || newAssembly.components.length === 0) return;

    const componentsWithNames = newAssembly.components.map(comp => {
      const mat = materials.find(m => m.id === comp.materialId);
      return {
        ...comp,
        materialName: mat ? mat.name : 'Unknown',
        requiredQty: Number(comp.requiredQty)
      };
    });

    const newId = Date.now().toString();
    const assemblyRef = doc(db, 'artifacts', appId, 'public', 'data', 'assemblies', newId);
    
    await setDoc(assemblyRef, {
      name: newAssembly.name,
      components: componentsWithNames,
      completedStock: 0,
      createdAt: Date.now()
    });

    setIsAddAssemblyModalOpen(false);
    setNewAssembly({ name: '', components: [], completedStock: 0 });
    setComponentSearchText('');
  };

  const handleDeleteAssembly = async (id) => {
    if (!user || !db) return;
    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'assemblies', id);
    await deleteDoc(ref);
  };

  const openEditAssembly = (assembly) => {
    setEditAssemblyData({ 
      ...assembly, 
      components: assembly.components.map(comp => ({ ...comp })) 
    });
    setEditComponentSearchText('');
    setIsEditAssemblyModalOpen(true);
  };

  const handleEditAssemblyComponentAdd = () => {
    setEditAssemblyData({
      ...editAssemblyData,
      components: [...editAssemblyData.components, { materialId: '', requiredQty: 1 }]
    });
  };

  const handleEditAssemblyComponentChange = (index, field, value) => {
    const updated = [...editAssemblyData.components];
    updated[index][field] = value;
    setEditAssemblyData({ ...editAssemblyData, components: updated });
  };

  const handleRemoveEditAssemblyComponent = (index) => {
    const updated = [...editAssemblyData.components];
    updated.splice(index, 1);
    setEditAssemblyData({ ...editAssemblyData, components: updated });
  };

  const handleEditAssemblySubmit = async (e) => {
    e.preventDefault();
    if (!user || !db || !editAssemblyData) return;
    if (!editAssemblyData.name || editAssemblyData.components.length === 0) return;

    const componentsWithNames = editAssemblyData.components.map(comp => {
      const mat = materials.find(m => m.id === comp.materialId);
      return {
        ...comp,
        materialName: mat ? mat.name : 'Unknown',
        requiredQty: Number(comp.requiredQty)
      };
    });

    const assemblyRef = doc(db, 'artifacts', appId, 'public', 'data', 'assemblies', editAssemblyData.id);
    
    await setDoc(assemblyRef, {
      name: editAssemblyData.name,
      components: componentsWithNames,
      updatedAt: Date.now()
    }, { merge: true });

    setIsEditAssemblyModalOpen(false);
    setEditAssemblyData(null);
  };

  const handleAssemblyAction = async (e) => {
    e.preventDefault();
    if (!user || !db || !shipModal.assembly) return;
    
    const count = Number(shipModal.count);
    if (count <= 0) return;

    const assemblyRef = doc(db, 'artifacts', appId, 'public', 'data', 'assemblies', shipModal.assembly.id);
    const currentCompletedStock = Number(shipModal.assembly.completedStock || 0);

    if (shipModal.type === 'complete') {
      const batch = writeBatch(db);
      let hasError = false;
      
      for (const comp of shipModal.assembly.components) {
        const mat = materials.find(m => m.id === comp.materialId);
        const totalNeeded = comp.requiredQty * count;
        
        if (!mat || mat.stock < totalNeeded) {
          setShipError(`재고 부족: ${comp.materialName} (필요: ${totalNeeded}, 현재: ${mat ? mat.stock : 0})`);
          hasError = true;
          break;
        }
      }

      if (hasError) return;

      const logNote = shipModal.note ? `조립 완성: ${shipModal.assembly.name} (${count}개) - ${shipModal.note}` : `조립 완성: ${shipModal.assembly.name} (${count}개)`;

      for (const comp of shipModal.assembly.components) {
        const mat = materials.find(m => m.id === comp.materialId);
        const totalNeeded = comp.requiredQty * count;
        const materialRef = doc(db, 'artifacts', appId, 'public', 'data', 'materials', mat.id);
        
        batch.update(materialRef, {
          stock: mat.stock - totalNeeded,
          totalConsumed: (mat.totalConsumed || 0) + totalNeeded,
          updatedAt: Date.now()
        });

        const logRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'logs'));
        batch.set(logRef, {
          materialId: mat.id,
          materialName: mat.name,
          type: 'out',
          quantity: totalNeeded,
          note: logNote,
          timestamp: Date.now()
        });
      }

      batch.update(assemblyRef, {
        completedStock: currentCompletedStock + count,
        updatedAt: Date.now()
      });

      await batch.commit();
    } else if (shipModal.type === 'ship') {
      if (currentCompletedStock < count) {
        setShipError(`완성된 조립품 재고가 부족합니다. (현재 완성 재고: ${currentCompletedStock}개)`);
        return;
      }

      const logNote = shipModal.note ? `조립품 출고: ${shipModal.assembly.name} (${count}개) - ${shipModal.note}` : `조립품 출고: ${shipModal.assembly.name} (${count}개)`;

      const logRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'logs'));
      await setDoc(logRef, {
        materialId: shipModal.assembly.id,
        materialName: `[조립품출고] ${shipModal.assembly.name}`,
        type: 'out',
        quantity: count,
        note: logNote,
        timestamp: Date.now()
      });

      await setDoc(assemblyRef, {
        completedStock: currentCompletedStock - count,
        updatedAt: Date.now()
      }, { merge: true });
    }

    setShipModal({ isOpen: false, assembly: null, count: 1, type: 'complete', note: '' });
    setShipError('');
  };

  // --- Derived State & Helpers ---
  const filteredMaterials = useMemo(() => {
    return materials.filter(m => 
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      m.code.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [materials, searchQuery]);

  const filteredAssemblies = useMemo(() => {
    return assemblies.filter(a => 
      a.name.toLowerCase().includes(assemblySearchQuery.toLowerCase())
    );
  }, [assemblies, assemblySearchQuery]);

  const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500">데이터를 불러오는 중입니다...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-12">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="bg-blue-600 p-2 rounded-lg text-white">
                <Box size={24} />
              </div>
              <h1 className="text-xl font-bold text-slate-900">자재 관리 시스템</h1>
            </div>
            <div className="flex items-center gap-4">
              {activeTab === 'inventory' && (
                <button 
                  onClick={() => setIsAddModalOpen(true)}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium shadow-sm"
                >
                  <Plus size={18} />
                  신규 자재 등록
                </button>
              )}
              {activeTab === 'assemblies' && (
                <button 
                  onClick={() => {
                    setComponentSearchText('');
                    setIsAddAssemblyModalOpen(true);
                  }}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium shadow-sm"
                >
                  <Plus size={18} />
                  새 조립품 등록
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Tabs */}
        <div className="flex space-x-1 bg-slate-200/50 p-1 rounded-lg w-fit mb-6">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'dashboard' ? 'bg-white text-blue-700 shadow' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingUp size={18} />
            모니터링 대시보드
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'inventory' ? 'bg-white text-blue-700 shadow' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardList size={18} />
            재고 입/출고
          </button>
          <button
            onClick={() => setActiveTab('assemblies')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'assemblies' ? 'bg-white text-indigo-700 shadow' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers size={18} />
            조립/세트 관리
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'history' ? 'bg-white text-blue-700 shadow' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History size={18} />
            소모 이력
          </button>
        </div>

        {/* Tab Content: Dashboard Monitoring */}
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-slate-200">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">재고 모니터링 대시보드</h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">등록된 핵심 품목의 재고를 한눈에 빠르게 파악합니다. (약 40개 이상 밀집형 표시)</p>
              </div>
              <button
                onClick={() => setIsPinModalOpen(true)}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg transition-colors text-xs sm:text-sm font-medium shadow-sm"
              >
                <Plus size={16} />
                모니터링 품목 추가/편집
              </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden p-3 sm:p-4">
              {pinnedItems.length === 0 ? (
                <div className="py-12 text-center">
                  <Package className="mx-auto text-slate-300 mb-3" size={40} />
                  <p className="text-slate-700 font-semibold text-sm mb-1">모니터링 등록된 품목이 없습니다.</p>
                  <p className="text-xs text-slate-400 mb-4">버튼을 눌러 모니터링할 자재나 조립품을 추가해보세요.</p>
                  <button
                    onClick={() => setIsPinModalOpen(true)}
                    className="inline-flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Plus size={14} /> 품목 추가하기
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {pinnedItems.map(item => {
                    if (item.type === 'material') {
                      const mat = materials.find(m => m.id === item.id);
                      if (!mat) return null;
                      const isShort = mat.stock < 10;
                      return (
                        <div key={`pin-m-${mat.id}`} className="bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-lg p-3 flex items-center justify-between transition-colors">
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">자재</span>
                              <span className="text-[11px] font-mono text-slate-400 truncate">[{mat.code}]</span>
                            </div>
                            <h4 className="text-xs font-bold text-slate-900 truncate" title={mat.name}>{mat.name}</h4>
                            {mat.spec && <p className="text-[10px] text-slate-500 truncate">{mat.spec}</p>}
                          </div>
                          <div className="text-right flex-shrink-0 flex items-center gap-2">
                            <div>
                              <div className={`text-sm sm:text-base font-black ${isShort ? 'text-red-600' : 'text-slate-900'}`}>
                                {mat.stock.toLocaleString()}
                              </div>
                              <div className="text-[10px] text-slate-500">{mat.unit}</div>
                            </div>
                            <button 
                              onClick={() => handleTogglePin(mat.id, 'material')}
                              className="text-slate-300 hover:text-red-500 p-1 transition-colors"
                              title="해제"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    } else {
                      const asm = assemblies.find(a => a.id === item.id);
                      if (!asm) return null;
                      return (
                        <div key={`pin-a-${asm.id}`} className="bg-indigo-50/40 hover:bg-indigo-50 border border-indigo-100 rounded-lg p-3 flex items-center justify-between transition-colors">
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="mb-0.5">
                              <span className="text-[9px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">조립품</span>
                            </div>
                            <h4 className="text-xs font-bold text-slate-900 truncate" title={asm.name}>{asm.name}</h4>
                          </div>
                          <div className="text-right flex-shrink-0 flex items-center gap-2">
                            <div>
                              <div className="text-sm sm:text-base font-black text-indigo-700">
                                {(asm.completedStock || 0).toLocaleString()}
                              </div>
                              <div className="text-[10px] text-indigo-500">개</div>
                            </div>
                            <button 
                              onClick={() => handleTogglePin(asm.id, 'assembly')}
                              className="text-slate-300 hover:text-red-500 p-1 transition-colors"
                              title="해제"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    }
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab Content: Inventory Status */}
        {activeTab === 'inventory' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="text" 
                  placeholder="품목코드 또는 자재명 검색..." 
                  className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 bg-slate-50/50"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">품목코드</th>
                    <th className="py-3 px-4">자재명</th>
                    <th className="py-3 px-4">규격</th>
                    <th className="py-3 px-4 text-right">현재고</th>
                    <th className="py-3 px-4 text-right">누적 소모량</th>
                    <th className="py-3 px-4">단위</th>
                    <th className="py-3 px-4">기타</th>
                    <th className="py-3 px-4 text-center">입고 / 출고</th>
                    <th className="py-3 px-4 text-center">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredMaterials.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="py-12 text-center text-slate-400">
                        등록된 자재가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredMaterials.map((mat) => (
                      <tr key={mat.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-500">{mat.code}</td>
                        <td className="py-3.5 px-4 font-bold text-slate-800">{mat.name}</td>
                        <td className="py-3.5 px-4 text-slate-600">{mat.spec || '-'}</td>
                        <td className="py-3.5 px-4 text-right font-bold text-slate-900 text-base">{mat.stock.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right text-slate-600">{mat.totalConsumed.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-slate-600">{mat.unit}</td>
                        <td className="py-3.5 px-4 text-slate-500 truncate max-w-xs" title={mat.note}>{mat.note || '-'}</td>
                        <td className="py-3.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button 
                              onClick={() => setTransactionModal({ isOpen: true, type: 'in', material: mat })}
                              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors shadow-sm active:scale-95"
                            >
                              <ArrowDownToLine size={16} /> 입고
                            </button>
                            <button 
                              onClick={() => setTransactionModal({ isOpen: true, type: 'out', material: mat })}
                              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors shadow-sm active:scale-95"
                            >
                              <ArrowUpFromLine size={16} /> 출고
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <button 
                              onClick={() => openEditMaterial(mat)}
                              className="p-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                              title="수정"
                            >
                              <Edit size={16} />
                            </button>
                            <button 
                              onClick={() => handleDelete(mat.id)}
                              className="p-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                              title="삭제"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab Content: Assemblies */}
        {activeTab === 'assemblies' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="text" 
                  placeholder="조립품 이름 검색..." 
                  className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500 bg-slate-50/50"
                  value={assemblySearchQuery}
                  onChange={(e) => setAssemblySearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredAssemblies.length === 0 ? (
                <div className="col-span-full bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-400">
                  등록된 조립품이 없습니다.
                </div>
              ) : (
                filteredAssemblies.map(asm => (
                  <div key={asm.id} className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between overflow-hidden">
                    <div className="p-5 border-b border-slate-100">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded uppercase">ASSEMBLY</span>
                          <h3 className="text-lg font-bold text-slate-900 mt-1">{asm.name}</h3>
                        </div>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => openEditAssembly(asm)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
                            title="조립품 수정"
                          >
                            <Edit size={16} />
                          </button>
                          <button 
                            onClick={() => handleDeleteAssembly(asm.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                            title="조립품 삭제"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      {/* Completed Stock Badge */}
                      <div className="bg-indigo-50/60 p-3 rounded-lg border border-indigo-100 flex justify-between items-center my-3">
                        <span className="text-xs font-bold text-indigo-900">조립 완성된 재고</span>
                        <span className="text-xl font-black text-indigo-700">{(asm.completedStock || 0).toLocaleString()} 개</span>
                      </div>

                      <div className="mt-4">
                        <p className="text-xs font-semibold text-slate-400 mb-2">구성 부품 목록 (1세트 기준)</p>
                        <ul className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                          {asm.components.map((comp, i) => {
                            const mat = materials.find(m => m.id === comp.materialId);
                            const currentStock = mat ? mat.stock : 0;
                            const isEnough = currentStock >= comp.requiredQty;
                            return (
                              <li key={i} className="text-xs flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-100">
                                <span className="font-medium text-slate-700">{comp.materialName}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-500 font-bold">{comp.requiredQty}개</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${isEnough ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600 font-bold'}`}>
                                    재고:{currentStock}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                    
                    <div className="p-4 bg-slate-50 border-t border-slate-100 grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => {
                          setShipError('');
                          setShipModal({ isOpen: true, assembly: asm, count: 1, type: 'complete', note: '' });
                        }}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl text-xs font-bold transition-colors shadow-sm active:scale-95"
                      >
                        조립 완성
                      </button>
                      <button 
                        onClick={() => {
                          setShipError('');
                          setShipModal({ isOpen: true, assembly: asm, count: 1, type: 'ship', note: '' });
                        }}
                        className="w-full bg-slate-800 hover:bg-slate-900 text-white py-2.5 rounded-xl text-xs font-bold transition-colors shadow-sm active:scale-95"
                      >
                        조립품 출고
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab Content: History */}
        {activeTab === 'history' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">소모 및 입출고 이력</h2>
              <p className="text-sm text-slate-500 mt-0.5">자재의 입고, 출고, 조립 완성 및 출고 이력을 시간순으로 확인합니다.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">일시</th>
                    <th className="py-3 px-4">구분</th>
                    <th className="py-3 px-4">자재/조립품명</th>
                    <th className="py-3 px-4 text-right">수량</th>
                    <th className="py-3 px-4">사유 / 비고</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="py-12 text-center text-slate-400">
                        기록된 이력이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 text-xs font-mono text-slate-500">{formatDate(log.timestamp)}</td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                            log.type === 'in' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                          }`}>
                            {log.type === 'in' ? '입고' : '출고'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-800">{log.materialName}</td>
                        <td className={`py-3 px-4 text-right font-bold ${log.type === 'in' ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {log.type === 'in' ? `+${log.quantity.toLocaleString()}` : `-${log.quantity.toLocaleString()}`}
                        </td>
                        <td className="py-3 px-4 text-slate-600 text-xs">{log.note || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Add Material Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">신규 자재 등록</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                &times;
              </button>
            </div>
            <form onSubmit={handleAddSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">품목코드 (선택)</label>
                <input type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500" 
                  placeholder="미입력시 자동생성" value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">자재명</label>
                <input required type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500" 
                  placeholder="예: 샤프트 링" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">규격 (선택)</label>
                  <input type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500" 
                    placeholder="예: M10x50" value={formData.spec} onChange={e => setFormData({...formData, spec: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">단위</label>
                  <input required type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500" 
                    placeholder="예: 개, EA, m" value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})} />
              </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">초기 재고수량</label>
                <input required type="number" min="0" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500" 
                  value={formData.stock} onChange={e => setFormData({...formData, stock: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">기타 (선택)</label>
                <textarea 
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none h-20" 
                  placeholder="특이사항이나 메모를 입력하세요."
                  value={formData.note} 
                  onChange={e => setFormData({...formData, note: e.target.value})} 
                ></textarea>
              </div>
              <div className="pt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md">
                  취소
                </button>
                <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-md font-medium">
                  등록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction Modal (In/Out) */}
      {transactionModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className={`px-6 py-4 flex justify-between items-center text-white ${
              transactionModal.type === 'in' ? 'bg-emerald-600' : 'bg-amber-600'
            }`}>
              <h3 className="text-lg font-bold">
                {transactionModal.type === 'in' ? '자재 입고' : '자재 출고'}
              </h3>
              <button onClick={() => setTransactionModal({ isOpen: false, type: null, material: null })} className="text-white/80 hover:text-white">
                &times;
              </button>
            </div>
            <form onSubmit={handleTransactionSubmit} className="p-6 space-y-4">
              <div>
                <p className="text-xs font-semibold text-slate-400">선택한 자재</p>
                <p className="text-base font-bold text-slate-800 mt-0.5">{transactionModal.material?.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">현재고: <span className="font-bold text-slate-700">{transactionModal.material?.stock} {transactionModal.material?.unit}</span></p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">수량</label>
                <input 
                  autoFocus
                  required 
                  type="number" 
                  min="1" 
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 font-bold" 
                  placeholder="수량 입력"
                  value={transactionAmount} 
                  onChange={e => setTransactionAmount(e.target.value)} 
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">비고 / 사유 (선택)</label>
                <input 
                  type="text"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder="예: 정기 입고, 라인 A 투입 등"
                  value={transactionNote}
                  onChange={e => setTransactionNote(e.target.value)}
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setTransactionModal({ isOpen: false, type: null, material: null })} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md">
                  취소
                </button>
                <button type="submit" className={`px-4 py-2 text-sm text-white rounded-md font-medium ${
                  transactionModal.type === 'in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
                }`}>
                  확인
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Assembly Modal */}
      {isAddAssemblyModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">새 조립품 등록</h3>
              <button onClick={() => setIsAddAssemblyModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                &times;
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-700 block mb-1">조립품 이름</label>
                <input 
                  type="text" 
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-500" 
                  placeholder="예: 유압 실린더 세트"
                  value={newAssembly.name} 
                  onChange={e => setNewAssembly({...newAssembly, name: e.target.value})} 
                />
              </div>
              
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold text-slate-700 block">구성품 목록 (1세트 기준)</label>
                  <button 
                    type="button" 
                    onClick={handleAddAssemblyComponent}
                    className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2 py-1 rounded transition-colors"
                  >
                    <Plus size={14} /> 자재 추가
                  </button>
                </div>
                
                {newAssembly.components.length === 0 ? (
                  <div className="text-sm text-center text-slate-500 py-4 bg-slate-50 rounded border border-dashed border-slate-200">
                    자재 추가 버튼을 눌러 구성품을 등록하세요.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {newAssembly.components.map((comp, idx) => {
                      const filteredCompMaterials = materials.filter(m => 
                        m.name.toLowerCase().includes(componentSearchText.toLowerCase()) || 
                        m.code.toLowerCase().includes(componentSearchText.toLowerCase())
                      );
                      return (
                        <div key={idx} className="flex flex-col sm:flex-row gap-2 items-center bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                          <div className="flex-1 w-full space-y-1">
                            <input 
                              type="text" 
                              placeholder="자재 검색 (명칭/코드)..." 
                              className="w-full border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-indigo-500 bg-white"
                              value={componentSearchText}
                              onChange={(e) => setComponentSearchText(e.target.value)}
                            />
                            <select 
                              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm outline-none focus:border-indigo-500 bg-white"
                              value={comp.materialId}
                              onChange={(e) => handleAssemblyComponentChange(idx, 'materialId', e.target.value)}
                            >
                              <option value="">자재 선택...</option>
                              {filteredCompMaterials.map(m => (
                                <option key={m.id} value={m.id}>
                                  [{m.code}] {m.name} {m.spec ? `(${m.spec})` : ''} (현재고: {m.stock})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-2 w-full sm:w-auto">
                            <input 
                              type="number" 
                              min="1"
                              className="w-20 border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-500 bg-white text-right"
                              value={comp.requiredQty}
                              onChange={(e) => handleAssemblyComponentChange(idx, 'requiredQty', e.target.value)}
                              placeholder="수량"
                            />
                            <button 
                              type="button" 
                              onClick={() => handleRemoveAssemblyComponent(idx)}
                              className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
              <button onClick={() => setIsAddAssemblyModalOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-md transition-colors">
                취소
              </button>
              <button 
                onClick={handleSaveAssembly} 
                disabled={!newAssembly.name || newAssembly.components.length === 0 || newAssembly.components.some(c => !c.materialId)}
                className="px-4 py-2 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-md font-medium disabled:opacity-50 transition-colors"
              >
                조립품 등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ship / Complete Assembly Modal */}
      {shipModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className={`px-6 py-4 flex justify-between items-center text-white ${
              shipModal.type === 'complete' ? 'bg-indigo-600' : 'bg-slate-800'
            }`}>
              <h3 className="text-lg font-bold">
                {shipModal.type === 'complete' ? '조립 완성' : '조립품 출고'}
              </h3>
              <button onClick={() => setShipModal({ isOpen: false, assembly: null, count: 1, type: 'complete', note: '' })} className="text-white/80 hover:text-white">
                &times;
              </button>
            </div>
            <form onSubmit={handleAssemblyAction} className="p-6 space-y-4">
              <div>
                <p className="text-xs font-semibold text-slate-400">대상 조립품</p>
                <p className="text-base font-bold text-slate-800 mt-0.5">{shipModal.assembly?.name}</p>
                <p className="text-xs text-indigo-600 mt-0.5 font-semibold">현재 완성 재고: {shipModal.assembly?.completedStock || 0} 개</p>
              </div>

              {shipError && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-3 py-2 rounded-lg text-xs flex items-center gap-2">
                  <AlertCircle size={16} />
                  <span>{shipError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">
                  {shipModal.type === 'complete' ? '완성할 수량' : '출고할 수량'}
                </label>
                <input 
                  autoFocus
                  required 
                  type="number" 
                  min="1" 
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-500 font-bold" 
                  value={shipModal.count} 
                  onChange={e => setShipModal({...shipModal, count: e.target.value})} 
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">비고 / 사유 (선택)</label>
                <input 
                  type="text" 
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-500" 
                  placeholder="예: 긴급 납품, 생산 완료 등"
                  value={shipModal.note} 
                  onChange={e => setShipModal({...shipModal, note: e.target.value})} 
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShipModal({ isOpen: false, assembly: null, count: 1, type: 'complete', note: '' })} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md">
                  취소
                </button>
                <button type="submit" className={`px-4 py-2 text-sm text-white rounded-md font-medium ${
                  shipModal.type === 'complete' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-800 hover:bg-slate-900'
                }`}>
                  확인
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pin Selection Modal for Dashboard Monitoring */}
      {isPinModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">모니터링 품목 선택</h3>
              <button onClick={() => setIsPinModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                &times;
              </button>
            </div>
            
            <div className="p-4 border-b border-slate-100 flex gap-2 bg-slate-50/50">
              <button
                onClick={() => setPinSearchType('material')}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${pinSearchType === 'material' ? 'bg-blue-600 text-white shadow-xs' : 'bg-white text-slate-600 border border-slate-200'}`}
              >
                개별 자재 보기
              </button>
              <button
                onClick={() => setPinSearchType('assembly')}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${pinSearchType === 'assembly' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white text-slate-600 border border-slate-200'}`}
              >
                조립품 보기
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-2">
              {pinSearchType === 'material' ? (
                materials.length === 0 ? (
                  <p className="text-center text-slate-400 py-8 text-sm">등록된 자재가 없습니다.</p>
                ) : (
                  materials.map(mat => {
                    const isPinned = pinnedItems.some(p => p.id === mat.id && p.type === 'material');
                    return (
                      <div key={mat.id} className="flex justify-between items-center p-3 rounded-lg border border-slate-200 hover:bg-slate-50">
                        <div>
                          <span className="text-xs font-semibold text-slate-400 mr-2">[{mat.code}]</span>
                          <span className="font-bold text-slate-800 text-sm">{mat.name}</span>
                          <span className="text-xs text-slate-500 ml-2">(현재고: {mat.stock} {mat.unit})</span>
                        </div>
                        <button
                          onClick={() => handleTogglePin(mat.id, 'material')}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${isPinned ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100' : 'bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100'}`}
                        >
                          {isPinned ? '해제' : '모니터링 추가'}
                        </button>
                      </div>
                    );
                  })
                )
              ) : (
                assemblies.length === 0 ? (
                  <p className="text-center text-slate-400 py-8 text-sm">등록된 조립품이 없습니다.</p>
                ) : (
                  assemblies.map(asm => {
                    const isPinned = pinnedItems.some(p => p.id === asm.id && p.type === 'assembly');
                    return (
                      <div key={asm.id} className="flex justify-between items-center p-3 rounded-lg border border-slate-200 hover:bg-slate-50">
                        <div>
                          <span className="font-bold text-slate-800 text-sm">{asm.name}</span>
                          <span className="text-xs text-indigo-600 font-semibold ml-2">(완성 재고: {asm.completedStock || 0}개)</span>
                        </div>
                        <button
                          onClick={() => handleTogglePin(asm.id, 'assembly')}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${isPinned ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100' : 'bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100'}`}
                        >
                          {isPinned ? '해제' : '모니터링 추가'}
                        </button>
                      </div>
                    );
                  })
                )
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end bg-slate-50">
              <button 
                onClick={() => setIsPinModalOpen(false)}
                className="px-4 py-2 text-sm bg-slate-800 text-white rounded-md font-medium hover:bg-slate-900 transition-colors"
              >
                완료
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Material Modal */}
      {isEditModalOpen && editFormData && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">자재 정보 수정</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                &times;
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">품목코드</label>
                <input type="text" className="w-full border border-slate-200 bg-slate-100 rounded-md px-3 py-2 text-sm text-slate-500 outline-none" 
                  value={editFormData.code} disabled />
                <p className="text-[10px] text-slate-400 mt-1">품목코드는 수정할 수 없습니다.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">자재명</label>
                <input required type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500" 
                  value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">규격 (선택)</label>
                  <input type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500" 
                    value={editFormData.spec} onChange={e => setEditFormData({...editFormData, spec: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">단위</label>
                  <input required type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500" 
                    value={editFormData.unit} onChange={e => setEditFormData({...editFormData, unit: e.target.value})} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">기타 (선택)</label>
                <textarea 
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none h-20" 
                  value={editFormData.note} 
                  onChange={e => setEditFormData({...editFormData, note: e.target.value})} 
                ></textarea>
              </div>
              <div className="pt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md">
                  취소
                </button>
                <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-md font-medium">
                  수정 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Assembly Modal */}
      {isEditAssemblyModalOpen && editAssemblyData && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">조립품(세트) 수정</h3>
              <button onClick={() => setIsEditAssemblyModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                &times;
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-700 block mb-1">조립품 이름</label>
                <input 
                  type="text" 
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-500" 
                  value={editAssemblyData.name} 
                  onChange={e => setEditAssemblyData({...editAssemblyData, name: e.target.value})} 
                />
              </div>
              
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold text-slate-700 block">구성품 목록 (1세트 기준)</label>
                  <button 
                    type="button" 
                    onClick={handleEditAssemblyComponentAdd}
                    className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2 py-1 rounded transition-colors"
                  >
                    <Plus size={14} /> 자재 추가
                  </button>
                </div>
                
                {editAssemblyData.components.length === 0 ? (
                  <div className="text-sm text-center text-slate-500 py-4 bg-slate-50 rounded border border-dashed border-slate-200">
                    자재 추가 버튼을 눌러 구성품을 등록하세요.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {editAssemblyData.components.map((comp, idx) => {
                      const filteredEditMaterials = materials.filter(m => 
                        m.name.toLowerCase().includes(editComponentSearchText.toLowerCase()) || 
                        m.code.toLowerCase().includes(editComponentSearchText.toLowerCase())
                      );
                      return (
                        <div key={idx} className="flex flex-col sm:flex-row gap-2 items-center bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                          <div className="flex-1 w-full space-y-1">
                            <input 
                              type="text" 
                              placeholder="자재 검색 (명칭/코드)..." 
                              className="w-full border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-indigo-500 bg-white"
                              value={editComponentSearchText}
                              onChange={(e) => setEditComponentSearchText(e.target.value)}
                            />
                            <select 
                              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm outline-none focus:border-indigo-500 bg-white"
                              value={comp.materialId}
                              onChange={(e) => handleEditAssemblyComponentChange(idx, 'materialId', e.target.value)}
                            >
                              <option value="">자재 선택...</option>
                              {filteredEditMaterials.map(m => (
                                <option key={m.id} value={m.id}>
                                  [{m.code}] {m.name} {m.spec ? `(${m.spec})` : ''} (현재고: {m.stock})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-2 w-full sm:w-auto">
                            <input 
                              type="number" 
                              min="1"
                              className="w-20 border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-500 bg-white text-right"
                              value={comp.requiredQty}
                              onChange={(e) => handleEditAssemblyComponentChange(idx, 'requiredQty', e.target.value)}
                              placeholder="수량"
                            />
                            <button 
                              type="button" 
                              onClick={() => handleRemoveEditAssemblyComponent(idx)}
                              className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
              <button onClick={() => setIsEditAssemblyModalOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-md transition-colors">
                취소
              </button>
              <button 
                onClick={handleEditAssemblySubmit} 
                disabled={!editAssemblyData.name || editAssemblyData.components.length === 0 || editAssemblyData.components.some(c => !c.materialId)}
                className="px-4 py-2 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-md font-medium disabled:opacity-50 transition-colors"
              >
                수정 완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}