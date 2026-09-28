# Regenerates test/reference.json from SciPy:  python3 test/make_reference.py
import json, numpy as np
from scipy import stats
A=[5.1,4.8,5.5,4.9,5.3,5.0,4.7,5.2]; B=[7.2,6.9,7.8,7.1,6.5,7.4,7.0,6.8]
C=[5.6,5.9,5.2,6.3,5.8,6.1]; D=[5.0,5.4,4.6,5.9,5.2,4.9,5.5]
E=[3.1,4.7,2.2,5.9,3.8,4.4,2.9]; F=[4.1,5.2,6.3,3.3,5.8,6.6]
T1=[1,2,2,3,3,3,4]; T2=[2,3,4,4,5,5,6,7]
X=[12.1,11.4,13.2,10.9,12.8,11.7,12.5,13.0,11.1,12.4]; Y=[11.2,11.6,12.1,10.1,12.0,11.9,11.3,12.2,10.4,12.6]
Xe=[1.83,0.50,1.62,2.48,1.68,1.88,1.55,3.06,1.30]; Ye=[0.878,0.647,0.598,2.05,1.06,1.29,1.06,3.14,1.29]
rng=np.random.default_rng(1); L1=list(np.round(rng.normal(10,2,60),3)); L2=list(np.round(rng.normal(11,2,55),3))
r={}
r['t_student']=stats.ttest_ind(A,C).pvalue; r['t_welch']=stats.ttest_ind(A,C,equal_var=False).pvalue
r['t_welch_df']=stats.ttest_ind(A,C,equal_var=False).df
r['paired']=stats.ttest_rel(X,Y).pvalue
r['mwu_exact']=stats.mannwhitneyu(E,F,method='exact').pvalue
r['mwu_exact_sep']=stats.mannwhitneyu(A,B,method='exact').pvalue
r['mwu_ties']=stats.mannwhitneyu(T1,T2,method='asymptotic',use_continuity=True).pvalue
r['mwu_large']=stats.mannwhitneyu(L1,L2,method='asymptotic').pvalue
r['wsr_exact']=stats.wilcoxon(Xe,Ye,method='exact').pvalue
r['wsr_approx_float_ties']=stats.wilcoxon(np.round(np.subtract(X,Y),10),method='approx',correction=True).pvalue
Xt=[1,2,3,4,5,6,7,8]; Yt=[2,1,1,2,3,3,4,5]
r['wsr_ties']=stats.wilcoxon(Xt,Yt,method='approx',correction=True,zero_method='wilcox').pvalue
r['anova']=stats.f_oneway(A,C,D).pvalue
th=stats.tukey_hsd(A,C,D); ci=th.confidence_interval()
r['tukey_p']=[th.pvalue[0,1],th.pvalue[0,2],th.pvalue[1,2]]
r['tukey_ci']=[[ci.low[0,1],ci.high[0,1]],[ci.low[0,2],ci.high[0,2]],[ci.low[1,2],ci.high[1,2]]]
dn=stats.dunnett(C,D,control=A,rng=np.random.default_rng(0)); dci=dn.confidence_interval()
r['dunnett_p']=list(dn.pvalue); r['dunnett_ci']=[[dci.low[i],dci.high[i]] for i in range(2)]
r['kw']=stats.kruskal(A,C,D).pvalue; r['kw_ties']=stats.kruskal(T1,T2,[3,4,5,5,6]).pvalue
r['sw']={str(n):list(stats.shapiro(L1[:n])) for n in [3,4,5,7,11,12,20,60]}
r['sw_B']=list(stats.shapiro(B))
r['bf']=stats.levene(A,C,D,center='median').pvalue
r['ptukey']=[[q,k,df,stats.studentized_range.cdf(q,k,df)] for q,k,df in [(3.5,3,10),(2,4,5),(5,6,2),(4,8,60),(3,3,1),(6,10,200),(1,2,3)]]
json.dump(dict(data=dict(E=E,F=F,A=A,B=B,C=C,D=D,T1=T1,T2=T2,X=X,Y=Y,L1=L1,L2=L2,Xt=Xt,Yt=Yt,Xe=Xe,Ye=Ye),ref=r),open('test/reference.json','w'),indent=1,default=float)
